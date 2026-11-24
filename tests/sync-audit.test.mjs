import test from "node:test";
import assert from "node:assert/strict";
import {buildAuditSnapshot,diffAuditSnapshots,probeAppsScript} from "../lib/sync-audit.mjs";
const itemHeader="product_key,sku,category,name,option_label,price_byn,image_url,available,active,brand,strength_mg,variant_image_url";
const categoryCSV="id,name,image_url,active,sort_order\nstationery,Stationery,,true,0";
const item=(id,name,price=10)=>[id,id,"Stationery",name,"",price,"",true,true,"","",""].join(",");
const csv=(...rows)=>[itemHeader,...rows].join("\n");

const config={spreadsheetId:"neutral-test-sheet-123456789",catalogGid:"123",categoriesGid:"456"};
test("snapshot uses row and group identity, includes inactive rows, detects category changes and rejects broken sources",async()=>{
 const a=await buildAuditSnapshot(csv(item("one","Notebook"),item("two","Pen")),categoryCSV,config);
 const b=await buildAuditSnapshot(csv(item("two","Pen"),item("one","Notebook")),categoryCSV,config);
 assert.equal(diffAuditSnapshots(a.snapshot,b.snapshot).items.unchanged,2);
 assert.equal(diffAuditSnapshots(a.snapshot,b.snapshot).groups.changed,0);
 assert.equal(JSON.stringify(a.snapshot).includes("Notebook"),false);
 const c=await buildAuditSnapshot(csv(item("one","Notebook").replace(",true,true,",",true,false,"),item("two","Pen")),categoryCSV.replace(",true,0",",false,0"),config);
 assert.equal(c.payload.activeRows,1);
 assert.equal(diffAuditSnapshots(b.snapshot,c.snapshot).items.changed,1);
 assert.equal(diffAuditSnapshots(b.snapshot,c.snapshot).categories.changed,1);
 await assert.rejects(buildAuditSnapshot(csv(item("one","Notebook")), "bad,header",config),/Проверка таблицы|Некорректная схема/);
 await assert.rejects(buildAuditSnapshot(csv(item("one","Notebook"),item("one","Notebook")),categoryCSV,config),/duplicate/);
});
test("probe rejects an untrusted URL and never sends token on a redirected GET",async()=>{
 const env={GOOGLE_SHEETS_WRITE_URL:"https://script.google.com/macros/s/test/exec",GOOGLE_SHEETS_WRITE_TOKEN:"fixture"};
 let count=0;
 const verified=await probeAppsScript(env,config,async(url,options)=>{
  count++;
  if(count===1){assert.equal(options.method,"POST");assert.equal(JSON.parse(options.body).action,"inspect");return new Response(null,{status:302,headers:{Location:"https://script.googleusercontent.com/macros/echo?key=temporary"}});}
  assert.equal(options.method,"GET");assert.equal(options.body,undefined);
  return Response.json({ok:true,schemaVersion:1,spreadsheetId:config.spreadsheetId,productGid:"123",categoryGid:"456",productHeaders:itemHeader.split(","),categoryHeaders:categoryCSV.split("\n")[0].split(",")});
 });
 assert.equal(verified.status,"verified");
 assert.equal((await probeAppsScript({...env,GOOGLE_SHEETS_WRITE_URL:"https://example.com/macros/s/test/exec"},config,()=>{throw Error("must not fetch");})).status,"invalid_url");
 assert.equal((await probeAppsScript(env,config,async()=>Response.json({ok:false,error:"Unknown action"}))).status,"needs_redeploy");
 assert.equal((await probeAppsScript(env,config,async()=>Response.json({ok:false,error:"Unauthorized"}))).status,"unauthorized");
});
