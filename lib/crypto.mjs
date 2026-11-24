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
  const encoder=new TextEncoder();
  const aBytes=encoder.encode(String(a??"")),bBytes=encoder.encode(String(b??""));
  if(typeof crypto.subtle.timingSafeEqual==="function"){
    if(aBytes.byteLength!==bBytes.byteLength)return !crypto.subtle.timingSafeEqual(aBytes,aBytes);
    return crypto.subtle.timingSafeEqual(aBytes,bBytes);
  }
  // Node test fallback; Workers use the native constant-time implementation above.
  let result=aBytes.byteLength^bBytes.byteLength;
  const max=Math.max(aBytes.byteLength,bBytes.byteLength);
  for(let i=0;i<max;i++)result|=(aBytes[i]||0)^(bBytes[i]||0);
  return result===0;
}
