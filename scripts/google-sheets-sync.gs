const PRODUCTS_SHEET = '������';
const CATEGORIES_SHEET = '��⥣�ਨ';

const PRODUCT_HEADERS = [
  'product_key','sku','category','name','option_label','price_byn','available','active',
  'manufacturer','image_url','variant_image_url','description','sort_order','popularity',
  'strength_mg','resistance_ohm','component_type','color'
];
const CATEGORY_HEADERS = [
  'category_key','label','image_url','icon','color','active','description','show_description','sort_order'
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Violet Shop')
    .addItem('����ந�� ��������', 'setupVioletShop')
    .addItem('�஢���� �����', 'validateVioletShop')
    .addToUi();
}

function setupVioletShop() {
  const ss = SpreadsheetApp.getActive();
  const products = ensureSheet_(ss, PRODUCTS_SHEET, PRODUCT_HEADERS);
  const categories = ensureSheet_(ss, CATEGORIES_SHEET, CATEGORY_HEADERS);
  products.setFrozenRows(1); categories.setFrozenRows(1);
  products.getRange(1,1,1,PRODUCT_HEADERS.length).setFontWeight('bold').setBackground('#202326').setFontColor('#ffffff');
  categories.getRange(1,1,1,CATEGORY_HEADERS.length).setFontWeight('bold').setBackground('#202326').setFontColor('#ffffff');
  products.autoResizeColumns(1,PRODUCT_HEADERS.length); categories.autoResizeColumns(1,CATEGORY_HEADERS.length);
  SpreadsheetApp.getUi().alert('��⮢�. �ᯮ������� ⮫쪮 ������� <������> � <��⥣�ਨ>.');
}

function validateVioletShop() {
  const ss=SpreadsheetApp.getActive();
  const products=sheetData_(ss.getSheetByName(PRODUCTS_SHEET));
  const categories=sheetData_(ss.getSheetByName(CATEGORIES_SHEET));
  const errors=[];
  duplicateErrors_(products,'product_key',errors,'������');
  duplicateErrors_(categories,'category_key',errors,'��⥣�ਨ');
  duplicateErrors_(categories,'label',errors,'��⥣�ਨ');
  products.rows.forEach((row,index)=>{
    if(!row.name||!row.category||row.price_byn==='')errors.push(`������: ��ப� ${index+2} - �������� name, category � price_byn`);
    ['image_url','variant_image_url'].forEach(key=>{if(row[key]&&!/^https:\/\//i.test(row[key]))errors.push(`������: ��ப� ${index+2} - ${key} ������ ���� HTTPS URL`);});
  });
  categories.rows.forEach((row,index)=>{if(row.image_url&&!/^https:\/\//i.test(row.image_url))errors.push(`��⥣�ਨ: ��ப� ${index+2} - image_url ������ ���� HTTPS URL`);});
  SpreadsheetApp.getUi().alert(errors.length?errors.slice(0,30).join('\n'):'�訡�� �� �������.');
}

function doPost(e) {
  try {
    const body=JSON.parse(e.postData&&e.postData.contents||'{}');
    const expected=PropertiesService.getScriptProperties().getProperty('SHEET_SYNC_SECRET');
    if(!expected||body.secret!==expected)throw new Error('Unauthorized');
    const ss=body.spreadsheetId?SpreadsheetApp.openById(body.spreadsheetId):SpreadsheetApp.getActive();
    ensureSheet_(ss,PRODUCTS_SHEET,PRODUCT_HEADERS); ensureSheet_(ss,CATEGORIES_SHEET,CATEGORY_HEADERS);
    if(body.action==='updateProductFamily')return output_(updateProductFamily_(ss,body));
    if(body.action==='replaceCategories')return output_(replaceCategories_(ss,body.categories));
    if(body.action==='setup')return output_({ok:true,...sheetInfo_(ss)});
    throw new Error('Unknown action');
  } catch(error) { return output_({ok:false,error:String(error.message||error)}); }
}

function updateProductFamily_(ss,body) {
  const data=sheetData_(ss.getSheetByName(PRODUCTS_SHEET));
  const identity=decodeFamily_(body.productId);
  const indexes=[];
  data.rows.forEach((row,index)=>{
    if(norm_(row.category)===identity[0]&&norm_(row.manufacturer)===identity[1]&&norm_(row.name)===identity[2]&&norm_(row.component_type)===identity[3])indexes.push(index);
  });
  if(!indexes.length)throw new Error('����窠 ⮢�� �� ������� � ���� <������>');
  const fields=body.fields||{};
  const sheet=ss.getSheetByName(PRODUCTS_SHEET);
  indexes.forEach(index=>Object.keys(fields).forEach(key=>{
    const column=data.headers.indexOf(key); if(column>=0)sheet.getRange(index+2,column+1).setValue(fields[key]);
  }));
  SpreadsheetApp.flush();
  return {ok:true,updatedRows:indexes.length};
}

function replaceCategories_(ss,categories) {
  if(!Array.isArray(categories))throw new Error('�����४�� ᯨ᮪ ��⥣�਩');
  const keys=new Set(),labels=new Set();
  categories.forEach(item=>{
    const key=norm_(item.key),label=norm_(item.label);
    if(!key||keys.has(key))throw new Error('ID ��⥣�਩ ������ ���� ��������� � 㭨�����');
    if(!label||labels.has(label))throw new Error('�������� ��⥣�਩ ������ ���� ��������� � 㭨�����');
    keys.add(key); labels.add(label);
  });
  const sheet=ensureSheet_(ss,CATEGORIES_SHEET,CATEGORY_HEADERS);
  if(sheet.getLastRow()>1)sheet.getRange(2,1,sheet.getLastRow()-1,CATEGORY_HEADERS.length).clearContent();
  if(categories.length){
    const values=categories.map((item,index)=>[item.key,item.label,item.image||'',item.icon||'',item.color||'#D8DDE0',item.active!==false,item.description||'',item.showDescription===true,index]);
    sheet.getRange(2,1,values.length,CATEGORY_HEADERS.length).setValues(values);
  }
  SpreadsheetApp.flush();
  return {ok:true,updatedRows:categories.length,...sheetInfo_(ss)};
}

function ensureSheet_(ss,name,headers) {
  const sheet=ss.getSheetByName(name)||ss.insertSheet(name);
  const current=sheet.getRange(1,1,1,Math.max(headers.length,sheet.getLastColumn())).getDisplayValues()[0];
  headers.forEach((header,index)=>{if(!current[index])sheet.getRange(1,index+1).setValue(header);});
  return sheet;
}
function sheetData_(sheet) {
  if(!sheet)throw new Error('�� ������� ��易⥫쭠� �������');
  const values=sheet.getDataRange().getDisplayValues(); const headers=(values.shift()||[]).map(String);
  return {headers,rows:values.filter(row=>row.some(Boolean)).map(row=>Object.fromEntries(headers.map((key,index)=>[key,String(row[index]||'').trim()]))) };
}
function duplicateErrors_(data,key,errors,name){const seen=new Set();data.rows.forEach((row,index)=>{const value=norm_(row[key]);if(value&&seen.has(value))errors.push(`${name}: ��ப� ${index+2} - ����� ${key}`);seen.add(value);});}
function decodeFamily_(id){const parts=String(id||'').replace(/^family:/,'').split('|').map(value=>norm_(decodeURIComponent(value)));while(parts.length<4)parts.push('');return parts;}
function norm_(value){return String(value||'').trim().toLocaleLowerCase('ru').replace(/\s+/g,' ');}
function sheetInfo_(ss){return {productsGid:ss.getSheetByName(PRODUCTS_SHEET).getSheetId(),categoriesGid:ss.getSheetByName(CATEGORIES_SHEET).getSheetId()};}
function output_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}

