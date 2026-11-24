import { sha256 } from "./crypto.mjs";
import { json } from "./http.mjs";

export const LOGIN_WINDOW_MS=15*60*1000;
export const LOGIN_LIMIT=15;

// One statement reserves a slot before credentials are evaluated. A shared
// bucket covers both staff entry points; no read/modify/write race.
export async function reserveLoginAttempt(env,request,timestamp=Date.now()){
  const ip=request.headers.get("CF-Connecting-IP")||"unknown";
  const key=await sha256(ip);
  const current=new Date(timestamp).toISOString();
  const cutoff=new Date(timestamp-LOGIN_WINDOW_MS).toISOString();
  const row=await env.DB.prepare(`INSERT INTO demo_login_attempts(ip_hash,attempts,window_started_at,locked_until)
    VALUES(?,1,?,NULL)
    ON CONFLICT(ip_hash) DO UPDATE SET
      attempts=CASE WHEN window_started_at<=? THEN 1 ELSE attempts+1 END,
      window_started_at=CASE WHEN window_started_at<=? THEN excluded.window_started_at ELSE window_started_at END,
      locked_until=NULL
    WHERE (locked_until IS NULL OR locked_until<=?)
      AND (window_started_at<=? OR attempts<?)
    RETURNING attempts`).bind(key,current,cutoff,cutoff,current,cutoff,LOGIN_LIMIT).first();
  return !!row;
}
export function loginRateLimited(){
  return json({error:"Слишком много попыток. Попробуйте через 15 минут."},429,{"Retry-After":"900"});
}
