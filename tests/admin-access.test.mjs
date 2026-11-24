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
