export const COOKIE = "violet_staff";
export const SESSION_DAYS = 30;
export function json(data,status=200,extra={}) {
  const headers=new Headers({
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff"
  });
  for(const [key,value] of Object.entries(extra))headers.set(key,value);
  return new Response(JSON.stringify(data),{status,headers});
}
export function textResponse(body,status=200,extra={}) {
  return new Response(body,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' https://telegram.org; connect-src 'self'; base-uri 'self'; object-src 'none'",...extra}});
}
export function parseCookie(request,name){
  const raw=request.headers.get("Cookie")||"";
  for(const part of raw.split(";")){
    const index=part.indexOf("=");
    if(index<0)continue;
    if(part.slice(0,index).trim()===name)return decodeURIComponent(part.slice(index+1).trim());
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
export async function bodyJson(request){
  const length=Number(request.headers.get("Content-Length")||0);
  if(length>100000)return null;
  try{return await request.json();}catch{return null;}
}
