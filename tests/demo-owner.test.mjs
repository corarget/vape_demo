import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolveDemoOwner, DEMO_OWNER_ID } from "../lib/demo-owner.mjs";

function fixture(){
  const db=new DatabaseSync(":memory:");
  for(const file of ["0001_init.sql","0004_staff_permissions.sql"])
    db.exec(readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8"));
  const env={DB:{prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},async first(){return db.prepare(sql).get(...this.args)||null;},async run(){return db.prepare(sql).run(...this.args);}};}}};
  return {db,env};
}

test("concurrent demo bootstrap converges on one owner",async()=>{
  const {db,env}=fixture();
  try{
    const owners=await Promise.all(Array.from({length:40},()=>resolveDemoOwner(env)));
    assert.equal(new Set(owners.map(owner=>owner?.id)).size,1);
    assert.equal(owners[0]?.id,DEMO_OWNER_ID);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM staff WHERE role='owner'").get().count,1);
  }finally{db.close();}
});

test("existing active owner is reused",async()=>{
  const {db,env}=fixture();
  try{
    db.prepare("INSERT INTO staff(id,display_name,role,active,created_at,permissions_json) VALUES(?,?,?,?,?,?)")
      .run("owner-1","Owner","owner",1,new Date().toISOString(),"[]");
    assert.equal((await resolveDemoOwner(env)).id,"owner-1");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM staff WHERE role='owner'").get().count,1);
  }finally{db.close();}
});

test("disabled fixed demo owner is not silently reactivated",async()=>{
  const {db,env}=fixture();
  try{
    db.prepare("INSERT INTO staff(id,display_name,role,active,created_at,permissions_json) VALUES(?,?,?,?,?,?)")
      .run(DEMO_OWNER_ID,"Disabled","owner",0,new Date().toISOString(),"[]");
    assert.equal(await resolveDemoOwner(env),null);
    assert.equal(db.prepare("SELECT active FROM staff WHERE id=?").get(DEMO_OWNER_ID).active,0);
  }finally{db.close();}
});
