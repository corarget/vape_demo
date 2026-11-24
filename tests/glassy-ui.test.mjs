import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const root=new URL("../",import.meta.url),read=p=>readFile(new URL(p,root),"utf8");
test("storefront and admin embed the shared glass skin",async()=>{
 const [store,admin]=await Promise.all([read("index.html"),read("admin.html")]);
 for(const html of [store,admin]){assert.match(html,/id="glassy-ui"/);assert.match(html,/--glass-panel/);assert.equal((html.match(/id="glassy-ui"/g)||[]).length,1);}
});
test("glass skin covers product and administration surfaces",async()=>{
 const css=await read("assets/glassy-ui.css");
 for(const selector of [".topbar",".hero",".category",".card",".bottom",".side",".section",".mobile-nav"])assert.ok(css.includes(selector),selector);
 assert.match(css,/backdrop-filter/);assert.match(css,/@media\(max-width:520px\)/);assert.ok(Buffer.byteLength(css)<24000);
});
