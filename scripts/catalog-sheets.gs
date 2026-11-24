/**
 * VIOLET SHOP — Google Sheets master catalog.
 * Bind this project to the existing spreadsheet (Extensions → Apps Script).
 * Tabs: "Товары" and "Категории".
 * Google Sheets is the only persistent source of product/category records.
 */
const SHOP = Object.freeze({
  PRODUCTS: 'Товары',
  CATEGORIES: 'Категории',
  REFRESH_URL: 'https://violet-shop-staging.platondran.workers.dev/api/catalog?refresh=1'
});
const CATEGORY_COLUMNS = ['id','name','image_url','active','sort_order','product_category'];
const EDITABLE_CATEGORY_COLUMNS = new Set(['name','image_url','active','sort_order','product_category']);
const EDITABLE_PRODUCT_COLUMNS = new Set([
  'name','category','option_label','price_byn','image_url','variant_image_url',
  'available','active','manufacturer','strength_mg'
]);

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Каталог магазина')
    .addItem('Проверить категории и связи', 'validateShopCatalog')
    .addItem('Проверить фото категорий', 'checkCategoryImages')
    .addItem('Обновить кеш магазина', 'refreshShopCache')
    .addSeparator()
    .addItem('Создать токен для API админки', 'createCatalogApiToken')
    .addToUi();
}
function shopSheets_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const products = book.getSheetByName(SHOP.PRODUCTS);
  const categories = book.getSheetByName(SHOP.CATEGORIES);
  if (!products || !categories) throw new Error('Нужны вкладки «Товары» и «Категории».');
  return {book, products, categories};
}
function headers_(sheet) {
  return sheet.getRange(1,1,1,sheet.getLastColumn()).getDisplayValues()[0]
    .map(v=>String(v).trim().toLowerCase());
}
function data_(sheet) {
  const n=sheet.getLastRow()-1;
  return n>0?sheet.getRange(2,1,n,sheet.getLastColumn()).getValues():[];
}
function rowObject_(headers,row) {
  return Object.fromEntries(headers.map((key,i)=>[key,row[i]]));
}
function assertCategory_(category,index,seenIds,seenProducts) {
  const id=String(category.id||'').trim();
  const name=String(category.name||'').trim();
  const productCategory=String(category.product_category||name).trim();
  if(!id||!name||!productCategory)throw new Error('Категории: пустой ID/название/связь в строке '+index);
  if(id===name)throw new Error('Категории: ID и название совпадают в строке '+index);
  if(!/^[a-z][a-z0-9-]*$/.test(id))throw new Error('Некорректный ID категории: '+id);
  if(seenIds.has(id))throw new Error('Повторяющийся ID: '+id);
  if(seenProducts.has(productCategory))throw new Error('Повторяющаяся связь: '+productCategory);
  seenIds.add(id);seenProducts.add(productCategory);
  const url=String(category.image_url||'').trim();
  if(url&&!/^https:\/\//i.test(url))throw new Error('Изображение должно быть HTTPS URL: '+id);
}
function validateShopCatalog() {
  const {products,categories}=shopSheets_();
  const ch=headers_(categories);
  for(const key of CATEGORY_COLUMNS)if(!ch.includes(key))throw new Error('В «Категории» нет колонки '+key);
  const ph=headers_(products);
  if(!ph.includes('category')||!ph.includes('sku'))throw new Error('В «Товары» нужны category и sku');
  const used=new Set(),mapped=new Set();
  const rows=data_(categories);
  rows.forEach((row,i)=>assertCategory_(rowObject_(ch,row),i+2,used,mapped));
  const categoryIndex=ph.indexOf('category');
  const missing=[...new Set(data_(products).map(row=>String(row[categoryIndex]||'').trim()).filter(v=>v&&!mapped.has(v)))];
  if(missing.length)throw new Error('Категории без сопоставления: '+missing.join(', '));
  SpreadsheetApp.getUi().alert('Проверено: '+rows.length+' категорий. Связи с товарами корректны.');
  return {categories:rows.length,missing};
}
function checkCategoryImages() {
  const {categories}=shopSheets_(),headers=headers_(categories),rows=data_(categories);
  const idCol=headers.indexOf('id'),urlCol=headers.indexOf('image_url'),fail=[];
  rows.forEach((row,i)=>{
    const id=String(row[idCol]||'').trim(),url=String(row[urlCol]||'').trim();
    if(!url){fail.push(id+' — нет URL');return;}
    try{
      const response=UrlFetchApp.fetch(url,{muteHttpExceptions:true,followRedirects:true});
      const bytes=response.getBlob().getBytes();
      const type=String(response.getHeaders()['Content-Type']||response.getHeaders()['content-type']||'');
      const png=[137,80,78,71,13,10,26,10];
      const isPng=png.every((n,j)=>(bytes[j]&255)===n);
      const isWebp=bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&
        String.fromCharCode(...bytes.slice(8,12))==='WEBP';
      if(response.getResponseCode()!==200||!/(image\/png|image\/webp)/i.test(type)||!(isPng||isWebp))
        fail.push(id+' — HTTP '+response.getResponseCode()+', '+type);
    }catch(error){fail.push(id+' — '+error.message);}
  });
  SpreadsheetApp.getUi().alert(fail.length?'Ошибки фото:\n'+fail.join('\n'):'Все '+rows.length+' изображений доступны и имеют корректный заголовок.');
}
function refreshShopCache(){
  const response=UrlFetchApp.fetch(SHOP.REFRESH_URL,{muteHttpExceptions:true});
  if(response.getResponseCode()!==200)throw new Error('Магазин вернул HTTP '+response.getResponseCode());
  SpreadsheetApp.getUi().alert('Каталог магазина обновлён из таблицы.');
}
function createCatalogApiToken(){
  const token=Utilities.getUuid()+Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('CATALOG_API_TOKEN',token);
  SpreadsheetApp.getUi().alert('Скопируйте токен и задайте его как секрет Cloudflare GOOGLE_SHEETS_WRITE_TOKEN:\n'+token);
}
function jsonResponse_(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function doPost(e){
  const lock=LockService.getScriptLock();
  try{
    const body=JSON.parse(e.postData?.contents||'{}');
    const secret=PropertiesService.getScriptProperties().getProperty('CATALOG_API_TOKEN');
    if(!secret||String(body.token||'')!==secret)return jsonResponse_({ok:false,error:'Unauthorized'});
    lock.waitLock(15000);
    const sheets=shopSheets_();
    const isCategory=body.action==='saveCategory';
    const isProduct=body.action==='saveProduct';
    if(!isCategory&&!isProduct)throw new Error('Unknown action');
    const sheet=isCategory?sheets.categories:sheets.products;
    const columns=headers_(sheet),keyField=isCategory?'id':'sku',key=String(body.id||body.sku||'').trim();
    if(!key)throw new Error('Missing '+keyField);
    const keyColumn=columns.indexOf(keyField);
    if(keyColumn<0)throw new Error('Missing key column '+keyField);
    const rows=data_(sheet),matches=[];
    rows.forEach((r,i)=>{if(String(r[keyColumn]).trim()===key)matches.push(i+2);});
    if(matches.length!==1)throw new Error('Expected one row with '+keyField+'='+key+'; found '+matches.length);
    const editable=isCategory?EDITABLE_CATEGORY_COLUMNS:EDITABLE_PRODUCT_COLUMNS;
    const changes=body.changes||{};
    for(const [field,value] of Object.entries(changes)){
      if(!editable.has(field))throw new Error('Column is not editable: '+field);
      const column=columns.indexOf(field);
      if(column<0)throw new Error('Column not found: '+field);
      if(field==='image_url'||field==='variant_image_url'){
        if(value&&!/^https:\/\//i.test(String(value)))throw new Error('Only HTTPS image URLs are allowed');
      }
      sheet.getRange(matches[0],column+1).setValue(value);
    }
    if(isCategory){
      const all=data_(sheets.categories),heads=headers_(sheets.categories),ids=new Set(),mapped=new Set();
      all.forEach((row,i)=>assertCategory_(rowObject_(heads,row),i+2,ids,mapped));
    }
    SpreadsheetApp.flush();
    return jsonResponse_({ok:true,row:matches[0]});
  }catch(error){return jsonResponse_({ok:false,error:String(error.message||error)});}
  finally{if(lock.hasLock())lock.releaseLock();}
}
