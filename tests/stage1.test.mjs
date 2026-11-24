import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../worker.mjs";
import { json, textResponse, validOrigin, parseCookie, bodyJson, cookieHeader } from "../lib/http.mjs";
import { sha256, randomToken, safeEqual } from "../lib/crypto.mjs";
import { first, all, run, getSetting } from "../lib/db.mjs";
import { normalizePermissions, hasPermission, permissionForAdminRoute } from "../lib/auth.mjs";
import { sanitizeTheme, sanitizeAdminAppearance } from "../lib/config.mjs";
const req = (path, options) => new Request("https://example.test" + path, options);
test("response headers and origin policy", async () => {
  const response = json({ok:true}, 201);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {ok:true});
  assert.match(textResponse("hi").headers.get("content-security-policy"), /object-src 'none'/);
  assert.equal(validOrigin(req("/", {headers:{Origin:"https://example.test"}})), true);
  assert.equal(validOrigin(req("/", {headers:{Origin:"https://other.test"}})), false);
});
test("cookies, JSON input and cryptographic helpers", async () => {
  assert.equal(parseCookie(req("/", {headers:{Cookie:"other=1; session=a%20b"}}), "session"), "a b");
  assert.match(cookieHeader("token"), /HttpOnly; Secure; SameSite=Strict/);
  assert.deepEqual(await bodyJson(req("/", {method:"POST",body:'{"a":1}'})), {a:1});
  assert.equal(await bodyJson(req("/", {method:"POST",body:"bad"})), null);
  assert.equal(await bodyJson(req("/", {method:"POST",headers:{"Content-Length":"100001"},body:"{}"})), null);
  assert.equal(await sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.match(randomToken(16), /^[0-9a-f]{32}$/);
  assert.equal(safeEqual("abc","abc"), true);
  assert.equal(safeEqual("abc","abd"), false);
});
test("JSON body limits actual bytes, including undeclared length and malformed UTF-8",async()=>{
  const make=body=>new Request("https://example.test",{method:"POST",body});
  assert.equal(await bodyJson(make(JSON.stringify({x:"x".repeat(100000)}))),null);
  assert.equal(await bodyJson(make(JSON.stringify({x:"я".repeat(50000)}))),null);
  assert.equal(await bodyJson(make(new Uint8Array([0x22,0xff,0x22]))),null);
  assert.equal((await bodyJson(make(JSON.stringify({x:"x".repeat(99992)})))).x.length,99992);
  const chunks=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"x":"'));c.enqueue(new Uint8Array(100000));c.close();}});
  assert.equal(await bodyJson(new Request("https://example.test",{method:"POST",body:chunks,duplex:"half"})),null);
});
test("D1 helpers preserve bindings and settings fallback", async () => {
  let bound;
  const statement={bind(...args){bound=args;return this;},async first(){return {value_json:'{"n":1}'};},async all(){return {results:[{n:1}]};},async run(){return {success:true};}};
  const env={DB:{prepare:()=>statement}};
  assert.deepEqual(await first(env,"SELECT ?",[7]), {value_json:'{"n":1}'});
  assert.deepEqual(bound,[7]);
  assert.deepEqual(await all(env,"SELECT 1"), [{n:1}]);
  assert.equal((await run(env,"SELECT 1")).success,true);
  assert.deepEqual(await getSetting(env,"x"), {n:1});
});
test("permission and appearance normalization", () => {
  assert.deepEqual(normalizePermissions(["branding.manage","invalid","branding.manage"]), ["branding.manage","branding"]);
  assert.deepEqual(normalizePermissions(["branding"],"courier"), []);
  assert.equal(hasPermission({role:"manager",permissions:["team"]},"team"),false);
  assert.equal(permissionForAdminRoute("/api/admin/logs","GET"),"logs");
  assert.equal(sanitizeTheme({background:"invalid"}).background,"#101112");
  assert.equal(sanitizeAdminAppearance({radius:999}).radius,14);
});
test("worker smoke: pages, health, preflight, rejected cross-origin and protected route", async () => {
  const env={DB:{prepare:()=>({first:async()=>({count:0})})}};
  const fetch=(path,options)=>worker.fetch(req(path,options),env,{});
  for (const path of ["/","/admin","/courier"]) {
    const r=await fetch(path);
    assert.equal(r.status,200);
    assert.match(r.headers.get("content-type"),/text\/html/);
    assert.match(await r.text(),/<html/i);
  }
  assert.equal((await fetch("/",{method:"HEAD"})).status,200);
  const health=await (await fetch("/api/health")).json();
  assert.equal(health.ok,true);
  assert.equal(health.database,true);
  assert.equal((await fetch("/not-a-route")).status,404);
  assert.equal((await fetch("/api/admin/logs")).status,401);
  assert.equal((await fetch("/api/admin/logs",{method:"POST",headers:{Origin:"https://other.test"}})).status,403);
  assert.equal((await fetch("/",{method:"OPTIONS"})).status,204);
});
test("no duplicate top-level function declarations in application scripts", async () => {
  for(const file of ["index.html","admin.html","worker.mjs"]){
    const source=await readFile(new URL("../"+file,import.meta.url),"utf8");
    const names=[...source.matchAll(/^(?:async )?function\s+(\w+)\s*\(/gm)].map(m=>m[1]);
    assert.equal(new Set(names).size,names.length,file);
  }
});
