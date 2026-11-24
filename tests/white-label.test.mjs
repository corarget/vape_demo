import test from "node:test";
import assert from "node:assert/strict";
import { buildWranglerConfig, deploymentConfig, isValidTimeZone, sanitizeWhiteLabelConfig } from "../lib/white-label.mjs";

test("deployment identity is normalized from environment",()=>{
  assert.deepEqual(deploymentConfig({STORE_ID:"north-shop",STORE_NAME:"North",STORE_LOCALE:"ru-RU",STORE_TIMEZONE:"Europe/Moscow",STORE_CURRENCY:"rub"}),{storeId:"north-shop",storeName:"North",locale:"ru-RU",timezone:"Europe/Moscow",currency:"RUB"});
});
test("invalid locale and timezone fall back safely",()=>{
  const value=sanitizeWhiteLabelConfig({locale:"bad_locale",timezone:"Moon/Base",currency:"12"});
  assert.equal(value.locale,"ru-BY"); assert.equal(value.timezone,"Europe/Minsk"); assert.equal(value.currency,"BYN");
  assert.equal(isValidTimeZone("Moon/Base"),false);
});
test("generated stores have isolated Worker, D1 and assets",()=>{
  const a=buildWranglerConfig({slug:"neutral-one",storeName:"Neutral One",locale:"en-US",timezone:"UTC",currency:"USD",databaseName:"neutral-one-db",databaseId:"11111111-1111-4111-8111-111111111111"});
  const b=buildWranglerConfig({slug:"neutral-two",storeName:"Neutral Two",locale:"ru-BY",timezone:"Europe/Minsk",currency:"BYN",databaseName:"neutral-two-db",databaseId:"22222222-2222-4222-8222-222222222222"});
  assert.notEqual(a.name,b.name); assert.notEqual(a.d1_databases[0].database_id,b.d1_databases[0].database_id);
  assert.equal(a.assets.directory,"./assets"); assert.equal(a.vars.GOOGLE_SHEET_ID,"");
});
