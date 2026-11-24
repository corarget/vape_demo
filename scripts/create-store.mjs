#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, writeFile, access, readFile } from "node:fs/promises";
import path from "node:path";
import { buildWranglerConfig, isValidLocale, isValidTimeZone, normalizeCurrency } from "../lib/white-label.mjs";

const ROOT=process.cwd();
const SOURCE_FILES=["worker.mjs","catalog.mjs","promotions.mjs","site.mjs","admin.mjs","index.html","admin.html","package.json","package-lock.json","wrangler.template.jsonc","README.md"];
const SOURCE_DIRS=["lib","migrations","assets","scripts","tests","docs"];
const NPX=process.platform==="win32"?"npx.cmd":"npx";
const NPM=process.platform==="win32"?"npm.cmd":"npm";
function run(command,args,options={}){
  const result=spawnSync(command,args,{cwd:options.cwd||ROOT,encoding:"utf8",input:options.input,windowsHide:true,shell:process.platform==="win32"});
  const output=[result.stdout,result.stderr].filter(Boolean).join("\n").trim();
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(output||"Команда завершилась с ошибкой");
  return output;
}
const wrangler=(args,options={})=>run(NPX,["wrangler",...args],options);
function databaseIdFrom(output){return (output.match(/database_id\s*=\s*["']?([0-9a-f-]{36})/i)||output.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i)||output.match(/"uuid"\s*:\s*"([0-9a-f-]{36})"/i))?.[1]||"";}
function deployedUrl(output){return output.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i)?.[0]||"";}
async function exists(target){try{await access(target);return true;}catch{return false;}}
async function question(rl,label,fallback){const answer=(await rl.question(label+(fallback?" ["+fallback+"]":"")+": ")).trim();return answer||fallback;}

async function main(){
  const rl=createInterface({input:stdin,output:stdout});
  try{
    const slug=(await question(rl,"Короткий ID магазина","")).toLowerCase();
    if(!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug))throw new Error("ID должен содержать 3–32 символа: латиница, цифры и дефисы.");
    const storeName=await question(rl,"Название магазина","Магазин");
    if(storeName.length<2||storeName.length>80)throw new Error("Название должно содержать от 2 до 80 символов.");
    const locale=await question(rl,"Локаль","ru-BY"); if(!isValidLocale(locale))throw new Error("Некорректная локаль.");
    const timezone=await question(rl,"Часовой пояс IANA","Europe/Minsk"); if(!isValidTimeZone(timezone))throw new Error("Некорректный часовой пояс.");
    const currency=normalizeCurrency(await question(rl,"Валюта ISO 4217","BYN"),""); if(!currency)throw new Error("Валюта должна состоять из трёх латинских букв.");

    const deploymentDir=path.join(ROOT,"deployments",slug);
    if(await exists(deploymentDir))throw new Error("Папка deployments/"+slug+" уже существует.");
    console.log("\nПроверяю исходный шаблон…");
    run(NPM,["test"]);
    wrangler(["whoami"]);

    const databaseName=slug+"-db";
    console.log("Создаю отдельную D1: "+databaseName);
    const createOutput=wrangler(["d1","create",databaseName,"--location","eeur"]);
    let databaseId=databaseIdFrom(createOutput);
    if(!databaseId)databaseId=databaseIdFrom(wrangler(["d1","info",databaseName,"--json"]));
    if(!databaseId)throw new Error("D1 создана, но database_id не прочитан.");

    await mkdir(deploymentDir,{recursive:true});
    for(const file of SOURCE_FILES)await cp(path.join(ROOT,file),path.join(deploymentDir,file));
    for(const dir of SOURCE_DIRS)await cp(path.join(ROOT,dir),path.join(deploymentDir,dir),{recursive:true});
    const config=buildWranglerConfig({slug,storeName,locale,timezone,currency,databaseName,databaseId});
    const configPath=path.join(deploymentDir,"wrangler.jsonc");
    await writeFile(configPath,JSON.stringify(config,null,2)+"\n","utf8");
    const pkgPath=path.join(deploymentDir,"package.json");
    const pkg=JSON.parse(await readFile(pkgPath,"utf8")); pkg.name=slug;
    pkg.scripts["db:migrate"]="wrangler d1 migrations apply "+databaseName+" --remote";
    await writeFile(pkgPath,JSON.stringify(pkg,null,2)+"\n","utf8");
    await writeFile(path.join(deploymentDir,".gitignore"),"node_modules/\n.wrangler/\n.dev.vars\n","utf8");

    const relativeConfig=path.relative(ROOT,configPath);
    console.log("Проверяю воспроизводимую сборку…");
    wrangler(["deploy","--dry-run","--config",relativeConfig,"--outdir",path.join("deployments",slug,".wrangler","build")]);
    console.log("Применяю миграции…");
    wrangler(["d1","migrations","apply",databaseName,"--remote","--config",relativeConfig]);
    console.log("Публикую отдельный Worker…");
    const deployOutput=wrangler(["deploy","--config",relativeConfig]);
    const url=deployedUrl(deployOutput);
    const bootstrapCode=randomBytes(24).toString("hex");
    wrangler(["secret","put","BOOTSTRAP_CODE","--config",relativeConfig],{input:bootstrapCode+"\n"});

    const handoff=["# "+storeName,"","Изоляция: отдельный Worker "+slug+" и отдельная D1 "+databaseName+".","Локаль: "+locale,"Часовой пояс: "+timezone,"Валюта: "+currency,url?"Витрина: "+url:"URL указан в выводе Wrangler.",url?"Админка: "+url+"/admin":"Админка: /admin","","1. Войдите одноразовым кодом владельца.","2. Подключите Google Sheets заказчика.","3. Настройте расписание и способы получения.","4. Удалите BOOTSTRAP_CODE после первого входа.","","Секреты в этот файл не записываются."].join("\n");
    await writeFile(path.join(deploymentDir,"HANDOFF.md"),handoff+"\n","utf8");
    console.log("\nМАГАЗИН СОЗДАН"+(url?"\nВитрина: "+url:"")+"\nПапка: deployments/"+slug+"\n\nОДНОРАЗОВЫЙ КОД ВЛАДЕЛЬЦА:\n"+bootstrapCode);
  }finally{rl.close();}
}
main().catch(error=>{console.error("\nОшибка мастера: "+(error?.message||String(error)));process.exitCode=1;});
