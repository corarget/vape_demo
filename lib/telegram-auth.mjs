import { safeEqual } from "./crypto.mjs";

// Validate the exact Telegram-signed payload; never trust initDataUnsafe for identity.
export async function verifyTelegramInitData(initData, botToken, nowSeconds = Math.floor(Date.now()/1000)) {
  if(typeof initData!=="string" || !initData || initData.length>16384 ||
     typeof botToken!=="string" || !botToken) return null;
  try {
    const params=new URLSearchParams(initData);
    const keys=new Set();
    for(const [key,value] of params){
      if(!/^[a-zA-Z0-9_]+$/.test(key) || keys.has(key) || /[\r\n]/.test(value)) return null;
      keys.add(key);
    }
    const hash=params.get("hash");
    const rawDate=params.get("auth_date");
    if(!/^[a-f0-9]{64}$/.test(hash||"") || !/^\d{1,12}$/.test(rawDate||"")) return null;
    const authDate=Number(rawDate);
    if(!Number.isSafeInteger(authDate)||authDate<=0||authDate>nowSeconds+60||nowSeconds-authDate>86400) return null;
    params.delete("hash");
    const checkString=[...params].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>key+"="+value).join("\n");
    const encoder=new TextEncoder();
    const key1=await crypto.subtle.importKey("raw",encoder.encode("WebAppData"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const secret=await crypto.subtle.sign("HMAC",key1,encoder.encode(botToken));
    const key2=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key2,encoder.encode(checkString)));
    const actual=[...signature].map(v=>v.toString(16).padStart(2,"0")).join("");
    if(!safeEqual(actual,hash)) return null;
    const user=JSON.parse(params.get("user")||"null");
    if(!user || typeof user!=="object" || Array.isArray(user) || !Number.isSafeInteger(user.id) || user.id<=0) return null;
    return user;
  } catch { return null; }
}

// A browser token must not override a Telegram identity or expose another account's data.
export function customerOrderScope(telegramUser, customerHash, suppliedInitData=false){
  if(suppliedInitData&&!telegramUser) return null;
  if(telegramUser) return {telegramId:String(telegramUser.id),customerHash:""};
  if(customerHash) return {telegramId:"",customerHash};
  return null;
}
