import { COOKIE, SESSION_DAYS, parseCookie, json } from "./http.mjs";
import { sha256, now, randomToken } from "./crypto.mjs";
import { first, run } from "./db.mjs";

export const PERMISSION_KEYS=["overview","orders","orders.manage","schedule","schedule.manage","catalog","catalog.manage","categories","categories.manage","analytics","branding","branding.manage","settings","settings.manage","team","logs","telegram","telegram.manage"];
export const SESSION_IDLE_MS=24*60*60*1000;
export const SESSION_TOUCH_MS=15*60*1000;
export const DEFAULT_MANAGER_PERMISSIONS=["overview","orders","orders.manage","schedule","schedule.manage","catalog","catalog.manage"];
export function normalizePermissions(value,role="manager"){
  if(role==="owner")return [...PERMISSION_KEYS];
  if(role==="courier")return [];
  const source=Array.isArray(value)?value:[];
  const result=[...new Set(source.filter(item=>PERMISSION_KEYS.includes(item)))];
  if(result.includes("orders.manage")&&!result.includes("orders"))result.push("orders");
  if(result.includes("catalog.manage")&&!result.includes("catalog"))result.push("catalog");
  if(result.includes("categories.manage")&&!result.includes("categories"))result.push("categories");
  if(result.includes("branding.manage")&&!result.includes("branding"))result.push("branding");
  if(result.includes("schedule.manage")&&!result.includes("schedule"))result.push("schedule");
  if(result.includes("settings.manage")&&!result.includes("settings"))result.push("settings");
  if(result.includes("telegram.manage")&&!result.includes("telegram"))result.push("telegram");
  return result;
}
export function permissionsFromStorage(value,role){
  let parsed=[];
  try{parsed=JSON.parse(value||"[]");}catch{}
  return normalizePermissions(parsed,role);
}
export async function getStaff(request,env){
  const token=parseCookie(request,COOKIE);
  if(!token)return null;
  const idHash=await sha256(token);
  const checkedAt=now();
  const idleCutoff=new Date(Date.now()-SESSION_IDLE_MS).toISOString();
  const row=await first(env,
    "SELECT s.id,s.display_name,s.role,s.telegram_id,s.active,s.permissions_json,ss.expires_at,ss.last_seen_at FROM sessions ss JOIN staff s ON s.id=ss.staff_id WHERE ss.id_hash=? AND ss.expires_at>? AND ss.last_seen_at>? AND s.active=1",
    [idHash,checkedAt,idleCutoff]);
  if(!row||!["owner","manager","courier"].includes(row.role))return null;
  const permissions=permissionsFromStorage(row.permissions_json,row.role);
  const lastSeen=Date.parse(row.last_seen_at||"");
  if(Number.isFinite(lastSeen)&&Date.now()-lastSeen>=SESSION_TOUCH_MS){
    const touchCutoff=new Date(Date.now()-SESSION_TOUCH_MS).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET last_seen_at=? WHERE id_hash=? AND last_seen_at<=?").bind(checkedAt,idHash,touchCutoff),
      env.DB.prepare("UPDATE staff SET last_seen_at=? WHERE id=? AND (last_seen_at IS NULL OR last_seen_at<=?)").bind(checkedAt,row.id,touchCutoff)
    ]);
  }
  // Persisted empty or malformed grants must never create new privileges.
  return {id:row.id,name:row.display_name,role:row.role,permissions,telegramId:row.telegram_id||"",expiresAt:row.expires_at};
}
export function isManager(staff){return !!staff&&["owner","manager"].includes(staff.role);}
export function permissionForAdminRoute(path,method){
  if(path==="/api/admin/dashboard")return "overview";
  if(path==="/api/admin/orders"||path.startsWith("/api/admin/orders/"))return method==="GET"?"orders":"orders.manage";
  if(path==="/api/admin/schedule-settings")return method==="GET"?"schedule":"schedule.manage";
  if(path==="/api/admin/slot-blocks"||path.startsWith("/api/admin/slot-blocks/"))return method==="GET"?"schedule":"schedule.manage";
  if(path==="/api/admin/couriers")return "orders.manage";
  if(path==="/api/admin/staff"||path.startsWith("/api/admin/staff/")||path==="/api/admin/invites")return "team";
  if(path==="/api/admin/analytics")return "analytics";
  if(path==="/api/admin/categories")return method==="GET"?"categories":"categories.manage";
  if(path==="/api/admin/branding")return method==="GET"?"branding":"branding.manage";
  if(path==="/api/admin/appearance")return method==="GET"?"branding":"branding.manage";
  if(path==="/api/admin/settings"||path==="/api/admin/promotions"||path==="/api/admin/promocodes")return method==="GET"?"settings":"settings.manage";
  if(path==="/api/admin/config/export")return "settings";
  if(path==="/api/admin/config/import")return "settings.manage";
  if(["/api/admin/catalog-products","/api/admin/catalog/products","/api/admin/catalog-preview","/api/admin/catalog-template","/api/admin/catalog-template/file","/api/admin/sync-settings","/api/admin/sync","/api/admin/sync-runs"].includes(path))return method==="GET"?"catalog":"catalog.manage";
  if(path==="/api/admin/logs")return "logs";
  if(path==="/api/admin/integrations")return method==="GET"?"telegram":"telegram.manage";
  if(path==="/api/admin/integrations/webhook")return "telegram.manage";
  return null;
}
export function hasPermission(staff,permission){
  if(!staff)return false;
  if(staff.role==="owner")return true;
  if(staff.role!=="manager"||permission==="team")return false;
  return Array.isArray(staff.permissions)&&staff.permissions.includes(permission);
}
export function unauthorized(){return json({error:"Требуется вход в панель управления" },401);}
export async function requireManager(request,env){
  const staff=await getStaff(request,env);
  return isManager(staff)?staff:null;
}
export async function requireCourier(request,env){
  const staff=await getStaff(request,env);
  return staff?.role==="courier"?staff:null;
}
export async function createSession(env,staffId){
  const token=randomToken(32);
  const idHash=await sha256(token);
  const created=now();
  const expires=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await run(env,"INSERT INTO sessions(id_hash,staff_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)",
    [idHash,staffId,created,expires,created]);
  return token;
}
