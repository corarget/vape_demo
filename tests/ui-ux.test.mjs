import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root=new URL("../",import.meta.url);
const read=path=>readFile(new URL(path,root),"utf8");

test("storefront and admin share one UX runtime",async()=>{
 const [store,admin]=await Promise.all([read("index.html"),read("admin.html")]);
 for(const html of [store,admin]){
  assert.match(html,/\/assets\/ux\.css/); assert.match(html,/\/assets\/ux\.js/);
  assert.equal((html.match(/\/assets\/ux\.css/g)||[]).length,1);
  assert.equal((html.match(/\/assets\/ux\.js/g)||[]).length,1);
 }
});
test("shared UX covers keyboard, motion, mobile and network states",async()=>{
 const [css,js]=await Promise.all([read("assets/ux.css"),read("assets/ux.js")]);
 assert.match(css,/:focus-visible/); assert.match(css,/prefers-reduced-motion/);
 assert.match(css,/max-width:720px/); assert.match(css,/min-height:44px/);
 assert.match(js,/skip-link/); assert.match(js,/aria-live/); assert.match(js,/offline/);
 assert.match(js,/window\.fetch/);
});
test("UX assets stay inside the performance budget",async()=>{
 const [css,js]=await Promise.all([read("assets/ux.css"),read("assets/ux.js")]);
 assert.ok(Buffer.byteLength(css)<8000); assert.ok(Buffer.byteLength(js)<8000);
});
