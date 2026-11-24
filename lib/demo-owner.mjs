import { first, run } from "./db.mjs";
import { now } from "./crypto.mjs";
import { PERMISSION_KEYS } from "./auth.mjs";

export const DEMO_OWNER_ID="demo-owner";

// A stable primary key makes concurrent bootstrap attempts converge on one row.
export async function resolveDemoOwner(env){
  const existing=await first(env,"SELECT id,display_name FROM staff WHERE role='owner' AND active=1 ORDER BY created_at LIMIT 1");
  if(existing)return existing;
  const created=now();
  await run(env,"INSERT OR IGNORE INTO staff(id,display_name,role,telegram_id,permissions_json,active,created_at,last_seen_at) VALUES(?,?,'owner',NULL,?,1,?,?)",
    [DEMO_OWNER_ID,"Демо-администратор",JSON.stringify(PERMISSION_KEYS),created,created]);
  return await first(env,"SELECT id,display_name FROM staff WHERE id=? AND role='owner' AND active=1",[DEMO_OWNER_ID]);
}
