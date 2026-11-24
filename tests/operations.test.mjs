import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeOperationalData,operationalEvent } from "../lib/operational-safety.mjs";
import { readFile } from "node:fs/promises";
test("operational logs redact customer data and secrets",()=>{
 const safe=sanitizeOperationalData({route:"/api/orders",token:"abc",phone:"+375",nested:{authorization:"Bearer x",count:2}});
 assert.deepEqual(safe,{route:"/api/orders",token:"[redacted]",phone:"[redacted]",nested:{authorization:"[redacted]",count:2}});
});
test("operational events use bounded neutral names",()=>{
 const event=operationalEvent("bad event / user",{count:1,password:"x"});
 assert.equal(event.event,"bad_event___user");assert.equal(event.password,"[redacted]");assert.match(event.at,/^\d{4}-/);
});
test("release scripts require explicit remote target and smoke URL",async()=>{
 const [backup,smoke,runbook]=await Promise.all([
  readFile(new URL("../scripts/backup-d1.mjs",import.meta.url),"utf8"),
  readFile(new URL("../scripts/smoke-test.mjs",import.meta.url),"utf8"),
  readFile(new URL("../docs/RUNBOOK.md",import.meta.url),"utf8")
 ]);
 assert.match(backup,/--remote/);assert.match(backup,/sha256/);assert.match(smoke,/SMOKE_BASE_URL/);
 assert.match(runbook,/Time Travel/);assert.match(runbook,/Rollback/);assert.match(runbook,/персональн/i);
});
