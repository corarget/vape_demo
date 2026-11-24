#!/usr/bin/env node
import assert from "node:assert/strict";
const base=String(process.env.SMOKE_BASE_URL||process.argv[2]||"").replace(/\/$/,"");
if(!/^https:\/\//.test(base))throw new Error("Передайте HTTPS URL: SMOKE_BASE_URL=https://… npm run smoke");
const checks=[
 ["/",200,/text\/html/],["/admin",200,/text\/html/],["/assets/ux.css",200,/text\/css/],
 ["/assets/ux.js",200,/(javascript|text\/plain)/],["/api/health",200,/application\/json/],
 ["/api/settings/public",200,/application\/json/],["/api/catalog",200,/application\/json/]
];
for(const [path,status,type] of checks){
 const response=await fetch(base+path,{headers:{"user-agent":"violet-release-smoke/1.0"}});
 assert.equal(response.status,status,path+" status");
 assert.match(response.headers.get("content-type")||"",type,path+" content-type");
 const body=await response.text();assert.ok(body.length>0,path+" empty body");
 if(path.startsWith("/api/"))assert.doesNotMatch(body,/(BOT_TOKEN|BOOTSTRAP_CODE|DEMO_ADMIN_PASSWORD|GOOGLE_SHEETS_WRITE_TOKEN)/i,path+" leaked a secret name");
 console.log("ok",path,response.status);
}
