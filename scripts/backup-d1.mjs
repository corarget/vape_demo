#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const outputDir=path.resolve(".backups");
await mkdir(outputDir,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,"-");
const sql=path.join(outputDir,"d1-"+stamp+".sql");
const command=process.platform==="win32"?"npx.cmd":"npx";
const result=spawnSync(command,["wrangler","d1","export","DB","--remote","--config","wrangler.jsonc","--output="+sql],{stdio:"inherit",shell:process.platform==="win32",windowsHide:true});
if(result.error)throw result.error;
if(result.status!==0)throw new Error("Экспорт D1 завершился с ошибкой.");
const data=await readFile(sql);
const manifest={createdAt:new Date().toISOString(),file:path.basename(sql),sha256:createHash("sha256").update(data).digest("hex"),bytes:data.length};
await writeFile(sql+".json",JSON.stringify(manifest,null,2)+"\n","utf8");
console.log("Backup:",sql);console.log("SHA-256:",manifest.sha256);
