#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile,access } from "node:fs/promises";
const required=["wrangler.jsonc","docs/RUNBOOK.md","scripts/smoke-test.mjs","scripts/backup-d1.mjs","docs/PROJECT_ROADMAP.md"];
for(const file of required)await access(file);
const config=JSON.parse(await readFile("wrangler.jsonc","utf8"));
assert.match(config.name,/^[a-z0-9-]+$/);assert.ok(config.d1_databases?.[0]?.database_id);
assert.notMatch=config.d1_databases[0].database_id.includes("REPLACE_");
assert.equal(assert.notMatch,false,"wrangler.jsonc contains a placeholder database");
assert.equal(config.assets?.directory,"./assets");
for(const key of ["STORE_ID","STORE_NAME","STORE_LOCALE","STORE_TIMEZONE","STORE_CURRENCY"])assert.ok(config.vars?.[key],key+" missing");
const source=await readFile("worker.mjs","utf8");
assert.doesNotMatch(source,/(sk-[a-z0-9]{20,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----)/i);
console.log("Release contract: ok");
