import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyTelegramInitData, customerOrderScope } from "../lib/telegram-auth.mjs";
import worker from "../worker.mjs";
const token="fixture-bot-token", now=1800000000;
function signed(user={id:123},date=now, extra={}){
 const p=new URLSearchParams({auth_date:String(date),user:JSON.stringify(user),...extra});
 const data=[...p].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+"="+v).join("\n");
 const key=createHmac("sha256","WebAppData").update(token).digest();
 p.set("hash",createHmac("sha256",key).update(data).digest("hex"));
 return p.toString();
}
test("Telegram validates signed payload and rejects malformed or stale identity",async()=>{
 assert.equal((await verifyTelegramInitData(signed(),token,now)).id,123);
 for(const bad of [signed({id:"123"}),signed({id:-1}),signed({id:1.5}),signed({id:123},now-86401),signed({id:123},now+61),signed()+"&user=%7B%7D",signed()+"&hash=deadbeef",signed().replace("123","456"),signed({id:123},now,{query_id:"a\nb"})]){
  assert.equal(await verifyTelegramInitData(bad,token,now),null);
 }
 assert.equal(await verifyTelegramInitData(signed(),"other-token",now),null);
});
test("Telegram identity takes precedence; failed Telegram auth cannot downgrade to browser token",()=>{
 assert.deepEqual(customerOrderScope({id:123},"browser",true),{telegramId:"123",customerHash:""});
 assert.equal(customerOrderScope(null,"browser",true),null);
 assert.deepEqual(customerOrderScope(null,"browser",false),{telegramId:"",customerHash:"browser"});
 assert.equal(customerOrderScope(null,""),null);
});
test("order list queries use isolated identity and reject invalid Telegram auth before database access",async()=>{
 let queries=[];
 const env={BOT_TOKEN:token,DB:{prepare(sql){return {bind(...args){queries.push({sql,args});return this;},async all(){return {results:[]}}}}}};
 const make=(data)=>new Request("https://example.test/api/orders",{headers:{"X-Customer-Token":"a".repeat(64),"X-Telegram-Init-Data":data}});
 let r=await worker.fetch(make("bad"),env,{});
 assert.equal(r.status,401);assert.equal(queries.length,0);
 r=await worker.fetch(make(signed({id:123},Math.floor(Date.now()/1000))),env,{});
 assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");
 assert.match(queries[0].sql,/WHERE telegram_user_id=\?/);assert.deepEqual(queries[0].args,["123"]);
 queries=[];r=await worker.fetch(make(""),env,{});
 assert.equal(r.status,200);assert.match(queries[0].sql,/COALESCE\(telegram_user_id,''\)=''/);
});
