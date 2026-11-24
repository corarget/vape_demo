import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { redeemStaffCredential } from "../lib/staff-redemption.mjs";

function fixture(){
 const db=new DatabaseSync(":memory:");
 for(const file of ["0001_init.sql","0004_staff_permissions.sql"]) db.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
 const env={DB:{prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;}};},async batch(statements){
  db.exec("BEGIN IMMEDIATE");
  try{const results=statements.map(s=>({meta:{changes:Number(db.prepare(s.sql).run(...s.args).changes)}}));db.exec("COMMIT");return results;}
  catch(e){db.exec("ROLLBACK");throw e;}
 }}};
 const count=table=>db.prepare("SELECT COUNT(*) AS n FROM "+table).get().n;
 return {db,env,count};
}
const data={staffId:"fixture-one",displayName:"Fixture",role:"manager",telegramId:"",permissions:["overview"],inviteId:"invite",codeHash:"fixture-hash"};
function invite(db,expires="2099-01-01T00:00:00.000Z"){
 db.prepare("INSERT INTO staff_invites(id,code_hash,display_name,role,created_at,expires_at) VALUES(?,?,?,'manager',?,?)").run("invite","fixture-hash","Fixture","2026-01-01T00:00:00.000Z",expires);
}
test("one-time invite cannot issue a second account or session",async()=>{
 const {db,env,count}=fixture();
 try{
  invite(db);
  assert.match(await redeemStaffCredential(env,data),/^[a-f0-9]{64}$/);
  assert.equal(await redeemStaffCredential(env,{...data,staffId:"fixture-two"}),null);
  assert.equal(count("staff"),1);assert.equal(count("sessions"),1);
  assert.equal(db.prepare("SELECT active FROM staff_invites").get().active,0);
 }finally{db.close();}
});
test("expired and mismatched invites cause no changes",async()=>{
 const {db,env,count}=fixture();
 try{invite(db,"2000-01-01T00:00:00.000Z");assert.equal(await redeemStaffCredential(env,data),null);assert.equal(count("staff"),0);assert.equal(count("sessions"),0);}finally{db.close();}
});
test("bootstrap can only be consumed once",async()=>{
 const {db,env,count}=fixture();
 try{
  const owner={...data,inviteId:null,role:"owner"};
  assert.match(await redeemStaffCredential(env,owner),/^[a-f0-9]{64}$/);
  assert.equal(await redeemStaffCredential(env,{...owner,staffId:"fixture-two"}),null);
  assert.equal(count("staff"),1);assert.equal(count("sessions"),1);
  assert.equal(db.prepare("SELECT value_json FROM settings WHERE key='bootstrap_used'").get().value_json,"true");
 }finally{db.close();}
});
test("failed session insert rolls back invite consumption and account creation",async()=>{
 const {db,env,count}=fixture();
 try{
  invite(db);db.exec("CREATE TRIGGER refuse_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
  await assert.rejects(redeemStaffCredential(env,data));
  assert.equal(count("staff"),0);assert.equal(count("sessions"),0);assert.equal(db.prepare("SELECT active FROM staff_invites").get().active,1);
 }finally{db.close();}
});
