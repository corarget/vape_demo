import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { getStaff, SESSION_IDLE_MS, SESSION_TOUCH_MS } from "../lib/auth.mjs";
import { COOKIE, cookieHeader, clearCookie, SESSION_DAYS } from "../lib/http.mjs";
import { sha256 } from "../lib/crypto.mjs";

function fixture(){
  const db=new DatabaseSync(":memory:");
  for(const file of ["0001_init.sql","0004_staff_permissions.sql"])
    db.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
  const env={DB:{
    prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(sql).get(...this.args)||null;},async run(){return db.prepare(sql).run(...this.args);}};},
    async batch(statements){return statements.map(statement=>db.prepare(statement.sql).run(...statement.args));}
  }};
  return {db,env};
}
async function addSession(db,lastSeen,expiresAt){
  const token="fixture-session-token";
  const hash=await sha256(token);
  const created=new Date(Date.now()-2*SESSION_IDLE_MS).toISOString();
  db.prepare("INSERT INTO staff(id,display_name,role,active,created_at,permissions_json) VALUES(?,?,?,?,?,?)")
    .run("staff-1","Fixture","manager",1,created,'["overview"]');
  db.prepare("INSERT INTO sessions(id_hash,staff_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)")
    .run(hash,"staff-1",created,expiresAt,lastSeen);
  return token;
}
const request=token=>new Request("https://example.test/api/staff/session",{headers:{Cookie:COOKIE+"="+encodeURIComponent(token)}});

test("staff session expires after 24 hours of inactivity",async()=>{
  const {db,env}=fixture();
  try{
    const token=await addSession(db,new Date(Date.now()-SESSION_IDLE_MS-1000).toISOString(),new Date(Date.now()+86400000).toISOString());
    assert.equal(await getStaff(request(token),env),null);
  }finally{db.close();}
});

test("active session is touched at most once per 15 minutes",async()=>{
  const {db,env}=fixture();
  try{
    const oldSeen=new Date(Date.now()-SESSION_TOUCH_MS-1000).toISOString();
    const token=await addSession(db,oldSeen,new Date(Date.now()+86400000).toISOString());
    const staff=await getStaff(request(token),env);
    assert.equal(staff?.id,"staff-1");
    const touched=db.prepare("SELECT last_seen_at FROM sessions").get().last_seen_at;
    assert.ok(touched>oldSeen);
    await getStaff(request(token),env);
    assert.equal(db.prepare("SELECT last_seen_at FROM sessions").get().last_seen_at,touched);
  }finally{db.close();}
});

test("staff cookie is host-only, secure and aligned with the absolute session lifetime",()=>{
  const cookie=cookieHeader("token");
  assert.match(cookie,new RegExp("^"+COOKIE+"="));
  assert.match(cookie,/; HttpOnly;/);
  assert.match(cookie,/; Secure;/);
  assert.match(cookie,/; SameSite=Strict;/);
  assert.match(cookie,/; Path=\//);
  assert.match(cookie,new RegExp("Max-Age="+SESSION_DAYS*86400+"$"));
  assert.doesNotMatch(cookie,/Domain=/i);
  assert.match(clearCookie(),/Max-Age=0$/);
});
