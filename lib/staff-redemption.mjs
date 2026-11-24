import { randomToken, sha256, now } from "./crypto.mjs";
import { SESSION_DAYS } from "./http.mjs";

// D1 batch is atomic. All subsequent writes are conditional on this attempt's
// unique staff ID, so a concurrent redemption can never issue another session.
export async function redeemStaffCredential(env,{staffId,displayName,role,telegramId,permissions,inviteId=null,codeHash}){
  const created=now(),expires=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  const token=randomToken(32),tokenHash=await sha256(token);
  const staffValues=[staffId,displayName,role,telegramId||null,JSON.stringify(permissions),created,created];
  const insert="INSERT INTO staff(id,display_name,role,telegram_id,permissions_json,active,created_at,last_seen_at) SELECT ?,?,?,?,?,1,?,? WHERE ";
  const exists="EXISTS(SELECT 1 FROM staff WHERE id=?)";
  const statements=[];
  if(inviteId){
    statements.push(env.DB.prepare(insert+"EXISTS(SELECT 1 FROM staff_invites WHERE id=? AND code_hash=? AND active=1 AND used_at IS NULL AND expires_at>?)").bind(...staffValues,inviteId,codeHash,created));
    statements.push(env.DB.prepare("UPDATE staff_invites SET active=0,used_at=? WHERE id=? AND "+exists).bind(created,inviteId,staffId));
  }else{
    statements.push(env.DB.prepare(insert+"NOT EXISTS(SELECT 1 FROM settings WHERE key='bootstrap_used' AND value_json!='false')").bind(...staffValues));
    for(const [key,value] of [["bootstrap_used","true"],["bootstrap_hash",'""']]){
      statements.push(env.DB.prepare("INSERT INTO settings(key,value_json,updated_at,updated_by) SELECT ?,?,?,'bootstrap' WHERE "+exists+" ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(key,value,created,staffId));
    }
  }
  statements.push(env.DB.prepare("INSERT INTO sessions(id_hash,staff_id,created_at,expires_at,last_seen_at) SELECT ?,?,?,?,? WHERE "+exists).bind(tokenHash,staffId,created,expires,created,staffId));
  const results=await env.DB.batch(statements);
  return Number(results[0]?.meta?.changes||0)===1?token:null;
}
