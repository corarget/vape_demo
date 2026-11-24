import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../admin.html",import.meta.url),"utf8");
const code=html.slice(html.indexOf("function syncSummary("),html.indexOf("async function loadCatalog(){"));
const summary=vm.runInNewContext(code+"\nsyncSummary");
const delta=(added=0,changed=0,removed=0)=>({baseline:false,added,changed,removed});
const input=(items,categories,integration="verified")=>({changes:{items,categories,groups:delta(100)},integration:{status:integration}});
test("compact report counts affected source records once and retains integration warning",()=>{
 assert.equal(summary(input(delta(1,2,3),delta(0,1,0))),"Затронуто записей: 7");
 assert.equal(summary(input(delta(),delta())),"Изменений нет");
 assert.equal(summary(input({baseline:true},delta())),"Первичная проверка завершена");
 assert.match(summary(input(delta(),delta(),"unauthorized")),/Интеграция не подтверждена/);
 assert.match(summary({}),/недоступно/);
});
test("removed diagnostic elements are not queried by the admin page",()=>{
 for(const text of ["sync-history","catalog-stats","sync-state","/api/admin/sync-runs"])assert.equal(html.includes(text),false);
});
