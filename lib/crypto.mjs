export function now(){return new Date().toISOString();}
export function randomId(){return crypto.randomUUID();}
export function randomToken(bytes=24){
  const data=crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map(value=>value.toString(16).padStart(2,"0")).join("");
}
export async function sha256(value){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
}
export function safeEqual(a,b){
  a=String(a??"");b=String(b??"");
  let result=a.length^b.length;
  const max=Math.max(a.length,b.length);
  for(let i=0;i<max;i++)result|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return result===0;
}
