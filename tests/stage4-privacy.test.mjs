import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { parseCookie, json, textResponse } from "../lib/http.mjs";
import worker from "../worker.mjs";
const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
const source=html.slice(html.indexOf("function guardedStorage("),html.indexOf("const state={screen:"));
function context(window){
 return runInNewContext(source+";({localStore,sessionStore,readStoredCart})",{window});
}
test("corrupt or unavailable storage cannot crash initialization",()=>{
 const broken={getItem(){throw Error("blocked")},setItem(){throw Error("blocked")},removeItem(){throw Error("blocked")}};
 const c=context({localStorage:broken,sessionStorage:broken});
 assert.equal(JSON.stringify(c.readStoredCart()),"{}");
 c.sessionStore.setItem("declined","yes");
 assert.equal(c.sessionStore.getItem("declined"),"yes");
 c.sessionStore.removeItem("declined");
 assert.equal(c.sessionStore.getItem("declined"),null);
 for(const value of ["bad","null","[]","42"]){
  const c=context({localStorage:{getItem:()=>value}});
  assert.equal(JSON.stringify(c.readStoredCart()),"{}");
 }
});
test("malformed cookie is rejected without leaking request data",()=>{
 assert.equal(parseCookie(new Request("https://example.test",{headers:{Cookie:"violet_staff=%ZZ"}}),"violet_staff"),"");
 assert.equal(json({}).headers.get("referrer-policy"),"no-referrer");
 assert.equal(textResponse("").headers.get("referrer-policy"),"no-referrer");
});
test("analytics respects server setting and does not retain free-form search",async()=>{
 const fetchEvent=async(enabled)=>{
  let inserts=[];
  const env={DB:{prepare(sql){return {bind(...args){if(sql.startsWith("INSERT INTO analytics_events"))inserts.push(args);return this;},async first(){return {value_json:JSON.stringify({analyticsEnabled:enabled})};},async run(){return {success:true};}}}}};
  const r=await worker.fetch(new Request("https://example.test/api/analytics/event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventType:"search",query:"private fixture",visitorToken:"a".repeat(40)})}),env,{});
  assert.equal(r.status,200);return inserts;
 };
 assert.equal((await fetchEvent(false)).length,0);
 const rows=await fetchEvent(true);assert.equal(rows.length,1);assert.equal(rows[0][5],null);
});
