import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";

function adminEnv(permissions){
  return {
    DB:{
      prepare(sql){
        return {
          bind(){return this;},
          async first(){
            if(sql.includes("FROM sessions ss"))return {
              id:"manager-1",display_name:"Manager",role:"manager",telegram_id:null,
              active:1,permissions_json:JSON.stringify(permissions),expires_at:"2099-01-01T00:00:00.000Z"
            };
            if(sql.includes("FROM settings"))return null;
            throw Error("Unexpected database read: "+sql);
          },
          async run(){throw Error("Unexpected database write: "+sql);}
        };
      }
    }
  };
}

function appearanceRequest(){
  return new Request("https://example.test/api/admin/appearance",{headers:{Cookie:"violet_staff=fixture"}});
}

test("manager without branding access cannot read admin appearance",async()=>{
  const response=await worker.fetch(appearanceRequest(),adminEnv(["overview"]),{});
  assert.equal(response.status,403);
  assert.match((await response.json()).error,/Недостаточно прав/);
});

test("manager with branding access can read admin appearance",async()=>{
  const response=await worker.fetch(appearanceRequest(),adminEnv(["branding"]),{});
  assert.equal(response.status,200);
  assert.equal((await response.json()).appearance.fontFamily,"Inter");
});

test("empty and invalid stored grants fail closed",async()=>{
 for(const value of [[],null,{},["unknown"]]){
  const response=await worker.fetch(appearanceRequest(),adminEnv(value),{});
  assert.equal(response.status,403);
 }
 const response=await worker.fetch(new Request("https://example.test/api/admin/dashboard",{headers:{Cookie:"violet_staff=fixture"}}),adminEnv([]),{});
 assert.equal(response.status,403);
});

test("staff patch validates before writing and revokes sessions in an atomic batch",async()=>{
 const writes=[];
 const env={DB:{prepare(sql){return {sql,bind(...args){this.args=args;return this;},async first(){
   if(sql.includes("FROM sessions ss"))return {id:"owner-1",display_name:"Owner",role:"owner",permissions_json:"[]"};
   if(sql.includes("SELECT id,role FROM staff"))return {id:"manager-1",role:"manager"};
   throw Error("unexpected read");
 },async run(){throw Error("unexpected non-atomic write");}};},async batch(statements){writes.push(statements);return statements.map(()=>({meta:{changes:1}}));}}};
 const request=body=>new Request("https://example.test/api/admin/staff/manager-1",{method:"PATCH",headers:{Cookie:"violet_staff=fixture",Origin:"https://example.test","Content-Type":"application/json"},body:JSON.stringify(body)});
 const bad=await worker.fetch(request({active:false,permissions:[]}),env,{});
 assert.equal(bad.status,400);assert.equal(writes.length,0);
 const wrongType=await worker.fetch(request({active:"false"}),env,{});
 assert.equal(wrongType.status,400);assert.equal(writes.length,0);
 const ok=await worker.fetch(request({active:false,permissions:["overview"]}),env,{});
 assert.equal(ok.status,200);assert.equal(writes.length,1);assert.equal(writes[0].length,2);
 assert.match(writes[0][0].sql,/UPDATE staff SET/);
 assert.match(writes[0][1].sql,/DELETE FROM sessions/);
});
