import test from "node:test";
import assert from "node:assert/strict";
import { auditData, ITEM_COLUMNS, CATEGORY_COLUMNS } from "../lib/data-contract.mjs";
const cat=["category-example","Example","https://example.test/a.png","TRUE","0","Example"];
const item=(key="group-1",sku="sku-1",link="Example",name="Sample")=>[key,sku,link,name,"Option","12.50","","TRUE","TRUE","Brand","",""];
const audit=(p,c=[cat])=>auditData([ITEM_COLUMNS,...p],[CATEGORY_COLUMNS,...c]);
test("repeated group key is valid when variants have distinct SKUs",()=>{
  const r=audit([item(),item("group-1","sku-2")]);assert.equal(r.ok,true);assert.equal(r.counts.groups,1);assert.equal(r.counts.uniqueSkus,2);
});
test("duplicate SKUs and orphan categories are reported without changing inputs",()=>{
  const rows=[item(),item("group-2","SKU-1","Unknown","Another")];const original=JSON.stringify(rows);const r=audit(rows);
  assert.equal(r.ok,false);assert.ok(r.issues.some(x=>x.field==="sku"&&x.relatedRow===2&&x.row===3));assert.ok(r.issues.some(x=>x.code==="unknown_category"));assert.equal(JSON.stringify(rows),original);
});
test("duplicate category display names, normalized keys and IDs fail",()=>{
  const r=audit([item()],"[cat,["category-example"," example ","","true","1","example"]]);
  for(const field of ["id","name","product_category"])assert.ok(r.issues.some(x=>x.field===field&&x.code==="duplicate"));
});
test("group key cannot identify distinct groups or change across variants",()=>{
  const r=audit([item(),item("group-1","sku-2","Example","Another"),item("group-2","sku-3")]);
  assert.ok(r.issues.some(x=>x.code==="group_key_conflict"));assert.ok(r.issues.some(x=>x.code==="multiple_group_keys"));
});
test("malformed values and conflicting headers are diagnosed",()=>{
  const row=item();row[5]="garbage";row[6]="http://example.test";row[7]="maybe";
  const r=audit([row]);for(const field of ["price_byn","image_url","available"])assert.ok(r.issues.some(x=>x.field===field));
  const bad=auditData([[...ITEM_COLUMNS,"sku"],item()],[CATEGORY_COLUMNS,cat]);assert.ok(bad.issues.some(x=>x.code==="duplicate_header"));
});
test("empty rows are ignored and blank optional images are allowed",()=>{
  const r=audit([item(),[]]);assert.equal(r.ok,true);assert.equal(r.counts.items,1);
});
