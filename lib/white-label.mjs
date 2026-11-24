export const DEFAULT_DEPLOYMENT_CONFIG=Object.freeze({
  storeId:"store",
  storeName:"Магазин",
  locale:"ru-BY",
  timezone:"Europe/Minsk",
  currency:"BYN"
});

export function normalizeStoreId(value,fallback=DEFAULT_DEPLOYMENT_CONFIG.storeId){
  const normalized=String(value||"").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(normalized)?normalized:fallback;
}
export function isValidLocale(value){
  try{new Intl.Locale(String(value));return true;}catch{return false;}
}
export function isValidTimeZone(value){
  try{new Intl.DateTimeFormat("en",{timeZone:String(value)});return true;}catch{return false;}
}
export function normalizeCurrency(value,fallback=DEFAULT_DEPLOYMENT_CONFIG.currency){
  const normalized=String(value||"").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized)?normalized:fallback;
}
export function deploymentConfig(env={}){
  return {
    storeId:normalizeStoreId(env.STORE_ID),
    storeName:String(env.STORE_NAME||DEFAULT_DEPLOYMENT_CONFIG.storeName).trim().slice(0,80)||DEFAULT_DEPLOYMENT_CONFIG.storeName,
    locale:isValidLocale(env.STORE_LOCALE)?String(env.STORE_LOCALE):DEFAULT_DEPLOYMENT_CONFIG.locale,
    timezone:isValidTimeZone(env.STORE_TIMEZONE)?String(env.STORE_TIMEZONE):DEFAULT_DEPLOYMENT_CONFIG.timezone,
    currency:normalizeCurrency(env.STORE_CURRENCY)
  };
}
export function sanitizeWhiteLabelConfig(value={},base=DEFAULT_DEPLOYMENT_CONFIG){
  return {
    storeName:String(value.storeName||base.storeName).trim().slice(0,80)||base.storeName,
    locale:isValidLocale(value.locale)?String(value.locale):base.locale,
    timezone:isValidTimeZone(value.timezone)?String(value.timezone):base.timezone,
    currency:normalizeCurrency(value.currency,base.currency)
  };
}
export function buildWranglerConfig({slug,storeName,locale,timezone,currency,databaseName,databaseId,compatibilityDate="2026-11-21"}){
  const storeId=normalizeStoreId(slug,"");
  if(!storeId)throw new Error("Некорректный ID магазина.");
  if(!/^[0-9a-f-]{36}$/i.test(String(databaseId)))throw new Error("Некорректный database_id D1.");
  const identity=sanitizeWhiteLabelConfig({storeName,locale,timezone,currency});
  return {
    "$schema":"node_modules/wrangler/config-schema.json",
    name:storeId,
    main:"worker.mjs",
    compatibility_date:compatibilityDate,
    observability:{enabled:true,head_sampling_rate:1},
    vars:{
      STORE_ID:storeId,STORE_NAME:identity.storeName,STORE_LOCALE:identity.locale,
      STORE_TIMEZONE:identity.timezone,STORE_CURRENCY:identity.currency,
      GOOGLE_SHEET_ID:"",GOOGLE_CATALOG_GID:"",GOOGLE_CATEGORIES_GID:""
    },
    d1_databases:[{binding:"DB",database_name:databaseName,database_id:databaseId,migrations_dir:"migrations"}],
    assets:{directory:"./assets"}
  };
}
