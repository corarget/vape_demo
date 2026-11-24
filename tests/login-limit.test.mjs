import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveLoginAttempt, LOGIN_WINDOW_MS, LOGIN_LIMIT } from "../lib/login-limit.mjs";
import worker from "../worker.mjs";
function fixture(){
 const db=new DatabaseSync(":memory:");
 for(const file of ["0001_init.sql","0004_staff_permissions.sql"])db.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 const env={DB:{prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(sql).get(...this.args)||null;}};}}};
 return {db,env};
}
const request=(ip="192.0.2.1",path="/api/staff/login")=>new Request("https://example.test"+path,{method:"POST",headers:{"CF-Connecting-IP":ip,"Content-Type":"application/json"},body:"{}"});
test("atomic limiter admits at most 15 reservations in a window",async()=>{
 const {db,env}=fixture();
 try{
  const timestamp=Date.now();
  const results=await Promise.all(Array.from({length:40},()=>reserveLoginAttempt(env,request(),timestamp)));
  assert.equal(results.filter(Boolean).length,LOGIN_LIMIT);
  assert.equal(await reserveLoginAttempt(env,request(),timestamp+LOGIN_WINDOW_MS-1),false);
  assert.equal(await reserveLoginAttempt(env,request(),timestamp+LOGIN_WINDOW_MS),true);
  assert.equal(await reserveLoginAttempt(env,request("192.0.2.2"),timestamp),true);
 }finally{db.close();}
});
test("both login paths share the bucket, including invalid payloads",async()=>{
 const {db,env}=fixture();
 try{
  env.DEMO_ADMIN_USERNAME="fixture";env.DEMO_ADMIN_PASSWORD="fixture";
  for(let i=0;i<LOGIN_LIMIT;i++){
   const r=await worker.fetch(request("192.0.2.1",i%2?"/api/staff/demo-login":"/api/staff/login"),env,{});
   assert.ok([400,401].includes(r.status));
  }
  for(const path of ["/api/staff/login","/api/staff/demo-login"]){
   const r=await worker.fetch(request("192.0.2.1",path),env,{});
   assert.equal(r.status,429);assert.equal(r.headers.get("Retry-After"),"900");
  }
 }finally{db.close();}
});
test("existing locked entries stay blocked until lock expires",async()=>{
 const {db,env}=fixture();
 try{
  const now=Date.now();
  await reserveLoginAttempt(env,request(),now);
  db.prepare("UPDATE demo_login_attempts SET locked_until=?").run(new Date(now+60000).toISOString());
  assert.equal(await reserveLoginAttempt(env,request(),now+59000),false);
  assert.equal(await reserveLoginAttempt(env,request(),now+60000),true);
 }finally{db.close();}
});
