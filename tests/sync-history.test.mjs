import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.mjs";

test("administrator read does not create a synchronization history entry", async () => {
  const writes=[];
  const env={
    GOOGLE_SHEET_ID:"neutral-test-sheet-123456789",
    GOOGLE_CATALOG_GID:"123",
    DB:{prepare(sql){return {
      bind(){return this;},
      async first(){
        if(sql.includes("FROM sessions ss"))return {id:"tester",display_name:"Test",role:"owner",permissions_json:"[]"};
        if(sql.includes("FROM settings"))return null;
        throw Error("Unexpected read: "+sql);
      },
      async run(){writes.push(sql);return {success:true};}
    };}}
  };
  const originalFetch=globalThis.fetch;
  try{
    globalThis.fetch=async url=>{
      assert.match(String(url),/^https:\/\/docs\.google\.com\/spreadsheets\//);
      return new Response("product_key,sku,category,name,price_byn,active,available\nitem-1,sku-1,Stationery,Notebook,10,true,true");
    };
    const response=await worker.fetch(new Request("https://example.test/api/admin/catalog/products",{headers:{Cookie:"violet_staff=fixture"}}),env,{});
    assert.equal(response.status,200);
    assert.equal((await response.json()).products.length,1);
    assert.deepEqual(writes,[]);
  }finally{globalThis.fetch=originalFetch;}
});

test("explicit sync is still recorded, while upstream errors are not reported as successful", async () => {
  const writes=[];
  const env={
    GOOGLE_SHEET_ID:"neutral-test-sheet-123456789",
    GOOGLE_CATALOG_GID:"123",
    DB:{prepare(sql){return {
      bind(...params){this.params=params;return this;},
      async first(){
        if(sql.includes("FROM sessions ss"))return {id:"tester",display_name:"Test",role:"owner",permissions_json:"[]"};
        if(sql.includes("FROM settings"))return null;
        throw Error("Unexpected read: "+sql);
      },
      async run(){writes.push([sql,this.params]);return {success:true};}
    };}}
  };
  const oldFetch=globalThis.fetch,oldCaches=Object.getOwnPropertyDescriptor(globalThis,"caches");
  const request=()=>new Request("https://example.test/api/admin/sync",{method:"POST",headers:{Cookie:"violet_staff=fixture",Origin:"https://example.test"}});
  try{
    Object.defineProperty(globalThis,"caches",{configurable:true,value:{default:{delete:async()=>true}}});
    globalThis.fetch=async()=>new Response("product_key,sku,category,name,price_byn,active,available\nitem-1,sku-1,Stationery,Notebook,10,true,true");
    const good=await worker.fetch(request(),env,{});
    assert.equal(good.status,200);
    assert.equal((await good.json()).summary.sourceRows,1);
    assert.equal(writes.filter(([sql])=>sql.includes("INSERT INTO sync_runs")).length,1);
    assert.equal(writes.filter(([sql])=>sql.includes("status='success'")).length,1);
    globalThis.fetch=async()=>new Response("denied",{status:403});
    const bad=await worker.fetch(request(),env,{});
    assert.equal(bad.status,500);
    assert.equal(writes.filter(([sql])=>sql.includes("status='error'")).length,1);
    assert.equal(writes.filter(([sql])=>sql.includes("status='success'")).length,1);
  }finally{
    globalThis.fetch=oldFetch;
    if(oldCaches)Object.defineProperty(globalThis,"caches",oldCaches);else delete globalThis.caches;
  }
});
