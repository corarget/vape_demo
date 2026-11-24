const SENSITIVE_KEY=/(token|secret|password|cookie|authorization|phone|telegram|email|address|name|payload|body)/i;
export function sanitizeOperationalData(value,depth=0){
  if(depth>4)return "[truncated]";
  if(value==null||typeof value==="boolean"||typeof value==="number")return value;
  if(typeof value==="string")return value.length>160?value.slice(0,157)+"...":value;
  if(Array.isArray(value))return value.slice(0,20).map(item=>sanitizeOperationalData(item,depth+1));
  if(typeof value==="object"){
    const result={};
    for(const [key,item] of Object.entries(value).slice(0,40))result[key]=SENSITIVE_KEY.test(key)?"[redacted]":sanitizeOperationalData(item,depth+1);
    return result;
  }
  return String(value);
}
export function operationalEvent(event,details={}){
  const safeEvent=String(event||"unknown").replace(/[^a-z0-9_.-]/gi,"_").slice(0,80);
  return {event:safeEvent,at:new Date().toISOString(),...sanitizeOperationalData(details)};
}
