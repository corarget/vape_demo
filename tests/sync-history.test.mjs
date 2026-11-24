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

const itemHeader="product_key,sku,category,name,option_label,price_byn,image_url,available,active,brand,strength_mg,variant_image_url";
const categoryCSV="id,name,image_url,active,sort_order\nstationery-group,Stationery,,true,0";
const item=(id,name,price=10)=>[id,id,"Stationery",name,"",price,"",true,true,"","",""].join(",");
const csv=(...rows)=>[itemHeader,...rows].join("\n");
test("explicit checks atomically persist a baseline, report real deltas and preserve the baseline after a failed read", async () => {
  let baseline=null;
  const writes=[],history=[];
  const env={
    GOOGLE_SHEET_ID:"neutral-test-sheet-123456789",GOOGLE_CATALOG_GID:"123",GOOGLE_CATEGORIES_GID:"456",
    DB:{prepare(sql){return {
      sql,bind(...params){this.params=params;return this;},
      async first(){
        if(sql.includes("FROM sessions ss"))return {id:"tester",display_name:"Test",role:"owner",permissions_json:"[]"};
        if(sql.includes("FROM settings"))return this.params?.[0]==="catalog_sync_baseline_v1"?baseline:null;
        throw Error("Unexpected read: "+sql);
      },
      async run(){writes.push([sql,this.params]);return {success:true};}
    };},async batch([setting,run]){
      const [key,value,at,by,expected,expectedBy]=setting.params;
      if(baseline&&(baseline.value_json!==expected||baseline.updated_by!==expectedBy))return [{meta:{changes:0}},{meta:{changes:0}}];
      baseline={value_json:value,updated_by:by};history.push(JSON.parse(run.params[4]));
      return [{meta:{changes:1}},{meta:{changes:1}}];
    }}
  };
  const oldFetch=globalThis.fetch;
  const request=()=>new Request("https://example.test/api/admin/sync",{method:"POST",headers:{Cookie:"violet_staff=fixture",Origin:"https://example.test"}});
  let items=csv(item("one","Notebook"),item("two","Pen")),fail=false;
  try{
    globalThis.fetch=async url=>{const gid=new URL(url).searchParams.get("gid");return gid==="456"?new Response(categoryCSV):fail?new Response("denied",{status:403}):new Response(items);};
    const sync=async()=>{const response=await worker.fetch(request(),env,{});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.summary;};
    assert.equal((await sync()).changes.items.baseline,true);
    assert.equal((await sync()).changes.items.unchanged,2);
    items=csv(item("one","Notebook",12),item("three","Ruler"));
    const changed=await sync();
    assert.equal(changed.changes.items.changed,1);assert.equal(changed.changes.items.added,1);assert.equal(changed.changes.items.removed,1);
    const before=baseline.value_json;fail=true;
    const bad=await worker.fetch(request(),env,{});
    assert.equal(bad.status,502);assert.equal(baseline.value_json,before);assert.equal(history.length,3);
    assert.equal(writes.filter(([sql])=>sql.includes("INSERT INTO sync_runs")).length,4);
    assert.equal(writes.filter(([sql])=>sql.includes("status='error'")).length,1);
    fail=false;assert.equal((await sync()).changes.items.changed,0);
  }finally{globalThis.fetch=oldFetch;}
});
