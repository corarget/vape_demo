import { now } from "./crypto.mjs";

export async function first(env,sql,params=[]){
  let stmt=env.DB.prepare(sql);
  if(params.length)stmt=stmt.bind(...params);
  return await stmt.first();
}
export async function all(env,sql,params=[]){
  let stmt=env.DB.prepare(sql);
  if(params.length)stmt=stmt.bind(...params);
  const result=await stmt.all();
  return result.results||[];
}
export async function run(env,sql,params=[]){
  let stmt=env.DB.prepare(sql);
  if(params.length)stmt=stmt.bind(...params);
  return await stmt.run();
}
export async function logSystem(env,level,area,message,details={}){
  try{
    await run(env,"INSERT INTO system_logs(level,area,message,details_json,created_at) VALUES(?,?,?,?,?)",
      [level,area,String(message).slice(0,500),JSON.stringify(details).slice(0,5000),now()]);
  }catch(error){console.error("system_log_write_failed",String(error));}
}
export async function getSetting(env,key,fallback=null){
  const row=await first(env,"SELECT value_json FROM settings WHERE key=?",[key]);
  if(!row)return fallback;
  try{return JSON.parse(row.value_json);}catch{return row.value_json??fallback;}
}
export async function setSetting(env,key,value,updatedBy="system"){
  await run(env,"INSERT INTO settings(key,value_json,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
    [key,JSON.stringify(value),now(),updatedBy]);
}
