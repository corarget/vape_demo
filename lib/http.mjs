export const COOKIE = "violet_staff";
export const SESSION_DAYS = 30;
export function json(data,status=200,extra={}) {
  const headers=new Headers({
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "Referrer-Policy":"no-referrer",
    "X-Content-Type-Options":"nosniff"
  });
  for(const [key,value] of Object.entries(extra))headers.set(key,value);
  return new Response(JSON.stringify(data),{status,headers});
}
export function textResponse(body,status=200,extra={}) {
  return new Response(body,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Content-Security-Policy":"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' https://telegram.org; connect-src 'self'; base-uri 'self'; object-src 'none'",...extra}});
}
export function parseCookie(request,name){
  const raw=request.headers.get("Cookie")||"";
  for(const part of raw.split(";")){
    const index=part.indexOf("=");
    if(index<0)continue;
    if(part.slice(0,index).trim()===name){try{return decodeURIComponent(part.slice(index+1).trim());}catch{return "";}}
  }
  return "";
}
export function cookieHeader(token,maxAge=SESSION_DAYS*86400){
  return COOKIE+"="+encodeURIComponent(token)+"; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age="+maxAge;
}
export function clearCookie(){return COOKIE+"=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";}
export function validOrigin(request){
  const origin=request.headers.get("Origin");
  return !origin||origin===new URL(request.url).origin;
}
// Enforce the actual byte limit, including requests without Content-Length.
export async function bodyJson(request){
  const limit=100000;
  const declared=request.headers.get("Content-Length");
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))return null;
  if(!request.body)return null;
  let reader;
  try{
    reader=request.body.getReader();
    const decoder=new TextDecoder("utf-8",{fatal:true});
    let size=0,text="";
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>limit){void reader.cancel().catch(()=>{});return null;}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
    return JSON.parse(text);
  }catch{return null;}
  finally{reader?.releaseLock();}
}
