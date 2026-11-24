// Explicit read-only source verification and minimal historical fingerprints.
import {parseCSV,parseCatalogCSV} from "../catalog.mjs";
import {auditData,ITEM_COLUMNS,CATEGORY_COLUMNS} from "./data-contract.mjs";
import {makeSnapshot,compareSnapshots} from "./snapshot-diff.mjs";
import {sha256,now} from "./crypto.mjs";

export const BASELINE_KEY="catalog_sync_baseline_v1";
const text=value=>String(value??"").trim();
const stableId=value=>text(value).normalize("NFKC").toLowerCase();
const trueValues=new Set(["true","1","yes","да"]);
function normalizeValue(field,value){
  const s=text(value);
  if(field==="active"||field==="available")return trueValues.has(s.toLowerCase());
  if(field==="price_byn")return Math.round(Number(s.replace(/\s/g,"").replace(",","."))*100);
  if(field==="sort_order")return Number(s);
  if(field==="sku"||field==="product_key"||field==="id")return stableId(s);
  return s;
}
function canonicalTable(rows,columns,label){
  const header=(rows[0]||[]).map(v=>text(v).replace(/^\uFEFF/,"").toLowerCase());
  if(header.length!==columns.length||new Set(header).size!==columns.length||columns.some(field=>!header.includes(field)))throw Error("Некорректная схема листа «"+label+"»");
  return rows.slice(1).map(cells=>Object.fromEntries(columns.map(field=>[field,normalizeValue(field,cells[header.indexOf(field)])])));
}
async function fingerprints(rows,columns,idField){
  const output=[];
  // Bound concurrency to avoid allocating thousands of pending digests at once.
  for(let offset=0;offset<rows.length;offset+=128){
    const batch=await Promise.all(rows.slice(offset,offset+128).map(async row=>({
      id:row[idField],group:row.product_key,
      value:await sha256(JSON.stringify(columns.map(field=>row[field])))
    })));
    output.push(...batch);
  }
  return output;
}
export async function readCSV(config,gid,fetcher=fetch){
  if(!/^[A-Za-z0-9_-]{20,}$/.test(config.spreadsheetId)||!/^\d+$/.test(gid))throw Error("Не настроен источник Google Sheets");
  const url="https://docs.google.com/spreadsheets/d/"+encodeURIComponent(config.spreadsheetId)+"/export?format=csv&gid="+encodeURIComponent(gid);
  const response=await fetcher(url,{headers:{Accept:"text/csv","Cache-Control":"no-cache"},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("Google Sheets: HTTP "+response.status);
  const csv=await response.text();
  if(!csv.trim()||/^\s*</.test(csv))throw Error("Google Sheets вернул не CSV");
  return csv;
}
export async function buildAuditSnapshot(itemCSV,categoryCSV,config){
  const items=parseCSV(itemCSV),categories=parseCSV(categoryCSV);
  const audit=auditData(items,categories);
  const skuColumn=(items[0]||[]).findIndex(v=>text(v).toLowerCase()==="sku");
  const permitted=audit.issues.filter(issue=>issue.sheet==="Товары"&&issue.field==="sku"&&issue.code==="duplicate"&&skuColumn>=0&&stableId(items[issue.row-1]?.[skuColumn])==="sku-03756");
  const fatal=audit.issues.filter(issue=>!permitted.includes(issue));
  // One deliberate duplicate is a documented exception; additional copies are not.
  if(fatal.length||permitted.length>1){
    const issue=fatal[0]||permitted[1];
    throw Error("Проверка таблицы: "+issue.sheet+", строка "+issue.row+", "+(issue.field||"схема")+" ("+issue.code+"); ошибок "+(fatal.length+Math.max(0,permitted.length-1)));
  }
  const records=canonicalTable(items,ITEM_COLUMNS,"Товары");
  const categoryRecords=canonicalTable(categories,CATEGORY_COLUMNS,"Категории");
  const source=await sha256(JSON.stringify([config.spreadsheetId,config.catalogGid,config.categoriesGid]));
  const itemFingerprints=await fingerprints(records,ITEM_COLUMNS,"sku");
  const categoryFingerprints=await fingerprints(categoryRecords,CATEGORY_COLUMNS,"id");
  const groups=new Map();
  for(const row of itemFingerprints){
    if(!groups.has(row.group))groups.set(row.group,[]);
    groups.get(row.group).push(row.value);
  }
  const groupFingerprints=await Promise.all([...groups].map(async([id,values])=>({id,value:await sha256(JSON.stringify(values.sort()))})));
  const snapshot={version:1,source,items:makeSnapshot(itemFingerprints,source),groups:makeSnapshot(groupFingerprints,source),categories:makeSnapshot(categoryFingerprints,source)};
  // Explicit verification and the normal parser consume the same product CSV.
  const payload={...parseCatalogCSV(itemCSV,{columnMapping:config.columnMapping||{}}),source:"google-sheets",updatedAt:now()};
  return {snapshot,payload,warnings:permitted.length?["Экспериментальный повтор SKU сохранён; сравнение дублей агрегированное."]:[]};
}
export function diffAuditSnapshots(previous,current){
  if(previous&&previous.version!==1)throw Error("Неизвестная версия базового снимка");
  return {items:compareSnapshots(previous?.items,current.items),groups:compareSnapshots(previous?.groups,current.groups),categories:compareSnapshots(previous?.categories,current.categories)};
}
export async function probeAppsScript(env,config,fetcher=fetch){
  if(!env.GOOGLE_SHEETS_WRITE_URL||!env.GOOGLE_SHEETS_WRITE_TOKEN)return {status:"not_configured"};
  let url;
  try{url=new URL(env.GOOGLE_SHEETS_WRITE_URL);}catch{return {status:"invalid_url"};}
  if(url.protocol!=="https:"||url.hostname!=="script.google.com"||url.username||url.password||url.port||!/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname)||url.search||url.hash)return {status:"invalid_url"};
  try{
    let response=await fetcher(url.toString(),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"inspect",token:env.GOOGLE_SHEETS_WRITE_TOKEN}),redirect:"manual",signal:AbortSignal.timeout(12000)});
    // ContentService responds with a temporary GET URL; never forward the token.
    if([301,302,303].includes(response.status)){
      const location=response.headers.get("Location");
      if(!location)return {status:"invalid_response"};
      const target=new URL(location,url);
      if(target.protocol!=="https:"||target.hostname!=="script.googleusercontent.com"||target.port||target.username||target.password)return {status:"invalid_redirect"};
      response=await fetcher(target.toString(),{method:"GET",redirect:"manual",signal:AbortSignal.timeout(12000)});
    }
    if(!response.ok)return {status:"http_error",httpStatus:response.status};
    const body=await response.json().catch(()=>null);
    if(body?.ok!==true){
      if(body?.error==="Unauthorized")return {status:"unauthorized"};
      if(body?.error==="Unknown action")return {status:"needs_redeploy"};
      return {status:"invalid_response"};
    }
    const same=body.schemaVersion===1&&String(body.spreadsheetId)===config.spreadsheetId&&String(body.productGid)===config.catalogGid&&String(body.categoryGid)===config.categoriesGid;
    const fields=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===expected.length&&expected.every(field=>actual.includes(field));
    if(!same||!fields(body.productHeaders,ITEM_COLUMNS)||!fields(body.categoryHeaders,CATEGORY_COLUMNS))return {status:"source_mismatch"};
    return {status:"verified"};
  }catch{return {status:"unreachable"};}
}
