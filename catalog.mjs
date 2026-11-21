const DEFAULT_SHEET_ID = "1jNoG5NTnJZbNCx7iAq3S1CcuS0J1EDc8BWeW-nzKNtk";
const DEFAULT_CATALOG_GID = "782461029";

const HEADER_ALIASES = {
  product_id:"product_key", productid:"product_key", id:"product_key",
  sku_id:"sku", variant_sku:"sku", article:"sku", артикул:"sku",
  category_name:"category", категория:"category",
  product_name:"name", title:"name", название:"name", товар:"name",
  variant:"option_label", variant_name:"option_label", option:"option_label",
  flavor:"option_label", taste:"option_label", вкус:"option_label",
  price:"price_byn", price_by:"price_byn", цена:"price_byn",
  in_stock:"available", stock:"available", наличие:"available",
  is_active:"active", enabled:"active", активен:"active",
  image:"image_url", photo:"image_url", photo_url:"image_url", фото:"image_url",
  описание:"description", priority:"sort_order", order:"sort_order",
  brand:"manufacturer", vendor:"manufacturer", producer:"manufacturer",
  manufacturer_name:"manufacturer", бренд:"manufacturer", производитель:"manufacturer",
  strength:"strength_mg", nicotine_strength:"strength_mg", крепость:"strength_mg",
  resistance:"resistance_ohm", ohm:"resistance_ohm", сопротивление:"resistance_ohm",
  type:"component_type", component:"component_type", тип:"component_type",
  colour:"color", цвет:"color"
};

const CORE_FIELDS = new Set([
  "product_key","sku","category","name","option_label","price_byn","available",
  "active","image_url","description","sort_order","popularity","manufacturer",
  "strength_mg","resistance_ohm","component_type","color"
]);

const FIELD_LABELS = {
  manufacturer:"Бренд",
  strength_mg:"Крепость",
  resistance_ohm:"Сопротивление",
  component_type:"Тип",
  color:"Цвет",
  brand_line:"Линейка",
  volume:"Объём",
  volume_ml:"Объём",
  size:"Размер",
  material:"Материал",
  weight:"Вес",
  warranty:"Гарантия",
  country_of_origin:"Страна производства",
  tags:"Теги",
  badge:"Метка",
  is_new:"Новинка"
};

function normalizeHeader(value) {
  const normalized=String(value??"").replace(/^\uFEFF/,"").trim().toLowerCase()
    .replace(/[\s\-./]+/g,"_").replace(/[^\p{L}\p{N}_]/gu,"");
  return HEADER_ALIASES[normalized]||normalized;
}
function clean(value){return String(value??"").trim();}
function norm(value){return clean(value).toLocaleLowerCase("ru").replace(/\s+/g," ");}
function parseBoolean(value,fallback){
  const text=clean(value).toLowerCase();
  if(!text)return fallback;
  if(["true","1","yes","y","да","есть","в наличии","available"].includes(text))return true;
  if(["false","0","no","n","нет","отсутствует","нет в наличии","unavailable"].includes(text))return false;
  return fallback;
}
function parseNumber(value){
  const text=clean(value).replace(/\s+/g,"").replace(/[^\d,.-]/g,"");
  if(!text)return null;
  let normalized=text;
  if(normalized.includes(",")&&normalized.includes(".")){
    normalized=normalized.lastIndexOf(",")>normalized.lastIndexOf(".")
      ?normalized.replace(/\./g,"").replace(",","."):normalized.replace(/,/g,"");
  }else normalized=normalized.replace(",",".");
  const number=Number(normalized);
  return Number.isFinite(number)?number:null;
}
function parsePrice(value){
  const number=parseNumber(value);
  return number===null?0:Math.round(number*100);
}
function safeImageUrl(value){
  const raw=clean(value);
  if(!raw)return "";
  try{const url=new URL(raw);return url.protocol==="https:"?url.toString():"";}catch{return "";}
}
function familyKey(row){
  return [
    norm(row.category)||"другое",
    norm(row.manufacturer)||"без бренда",
    norm(row.name)||"без названия",
    norm(row.component_type)
  ].join("|");
}
function familyId(key){return "family:"+key.split("|").map(encodeURIComponent).join("|");}
function publicAttribute(field,value){
  if(!value)return null;
  let key=field;
  if(key.startsWith("public_"))key=key.slice(7);
  else if(key.startsWith("display_"))key=key.slice(8);
  else if(!Object.prototype.hasOwnProperty.call(FIELD_LABELS,key))return null;
  if(!key)return null;
  return {key,label:FIELD_LABELS[key]||key.replace(/_/g," "),value};
}

export function parseCSV(text){
  const source=String(text??"").replace(/^\uFEFF/,"");
  const rows=[];let row=[];let cell="";let quoted=false;
  for(let i=0;i<source.length;i++){
    const char=source[i];
    if(char==='"'&&quoted&&source[i+1]==='"'){cell+='"';i++;}
    else if(char==='"')quoted=!quoted;
    else if(char===","&&!quoted){row.push(cell);cell="";}
    else if((char==="\n"||char==="\r")&&!quoted){
      if(char==="\r"&&source[i+1]==="\n")i++;
      row.push(cell);if(row.some(value=>String(value).trim()!==""))rows.push(row);
      row=[];cell="";
    }else cell+=char;
  }
  if(quoted)throw new Error("В CSV обнаружено незакрытое поле в кавычках");
  row.push(cell);if(row.some(value=>String(value).trim()!==""))rows.push(row);
  return rows;
}

export function parseCatalogCSV(csvText){
  if(!csvText||/^\s*</.test(csvText))throw new Error("Google Sheets вернул не CSV. Проверьте доступ к таблице");
  const rows=parseCSV(csvText);
  const rawHeaders=rows.shift();
  if(!rawHeaders?.length)throw new Error("В листе Catalog нет строки заголовков");
  const headers=rawHeaders.map(normalizeHeader);
  const headerSet=new Set(headers);
  for(const required of ["product_key","name","category","price_byn"]){
    if(!headerSet.has(required))throw new Error("В листе Catalog отсутствует обязательный столбец: "+required);
  }

  const families=new Map();
  const allFields=new Map();
  let activeRows=0;
  rows.forEach((values,rowIndex)=>{
    const row={};
    headers.forEach((header,columnIndex)=>{if(header)row[header]=clean(values[columnIndex]);});
    const productKey=clean(row.product_key)||clean(row.sku);
    if(!productKey||!parseBoolean(row.active,true))return;
    activeRows++;

    const key=familyKey(row);
    const price=parsePrice(row.price_byn);
    const sortOrder=parseNumber(row.sort_order);
    const popularity=parseNumber(row.popularity);
    let product=families.get(key);
    if(!product){
      product={
        id:familyId(key),
        category:clean(row.category)||"Другое",
        name:clean(row.name)||productKey,
        manufacturer:clean(row.manufacturer)||"",
        brand:clean(row.manufacturer)||"",
        image:safeImageUrl(row.image_url),
        description:clean(row.description),
        available:false,
        price,
        priceMin:price,
        priceMax:price,
        popularity:popularity??0,
        sortOrder:sortOrder??rowIndex,
        options:[],
        attributes:{},
        _strengths:new Set(),
        _optionLabels:new Set()
      };
      families.set(key,product);
    }else{
      if(!product.image&&row.image_url)product.image=safeImageUrl(row.image_url);
      if(!product.description&&row.description)product.description=clean(row.description);
      if(sortOrder!==null)product.sortOrder=Math.min(product.sortOrder,sortOrder);
      if(popularity!==null)product.popularity=Math.max(product.popularity,popularity);
    }

    const attrs={};
    for(const [field,value] of Object.entries(row)){
      if(!value||CORE_FIELDS.has(field))continue;
      const attribute=publicAttribute(field,value);
      if(!attribute)continue;
      attrs[attribute.key]=attribute.value;
      allFields.set(attribute.key,attribute.label);
    }
    for(const field of ["strength_mg","resistance_ohm","component_type","color"]){
      if(row[field]){
        const attribute=publicAttribute(field,row[field]);
        attrs[field]=row[field];
        allFields.set(field,attribute.label);
      }
    }

    const strength=clean(row.strength_mg);
    if(strength)product._strengths.add(strength);
    const baseLabel=clean(row.option_label)||clean(row.color)||clean(row.resistance_ohm)||"Основной вариант";
    product._optionLabels.add(baseLabel);
    const option={
      variantId:productKey,
      productKey,
      sku:clean(row.sku),
      label:baseLabel,
      available:parseBoolean(row.available,false),
      price,
      sortOrder:sortOrder??rowIndex,
      attributes:attrs
    };
    product.options.push(option);
    product.available=product.available||option.available;
    product.priceMin=Math.min(product.priceMin,price);
    product.priceMax=Math.max(product.priceMax,price);
  });

  const products=[...families.values()].map(product=>{
    const hasMultipleStrengths=product._strengths.size>1;
    product.options=product.options.map(option=>{
      const strength=option.attributes.strength_mg;
      const label=hasMultipleStrengths&&strength?option.label+" · "+strength+" мг":option.label;
      return {...option,label};
    });
    product.options.sort((a,b)=>
      Number(b.available)-Number(a.available)||
      a.sortOrder-b.sortOrder||
      a.label.localeCompare(b.label,"ru")
    );

    const allOptionAttrs=product.options.map(option=>option.attributes);
    const commonKeys=new Set(allOptionAttrs.flatMap(attrs=>Object.keys(attrs)));
    for(const key of commonKeys){
      const values=[...new Set(allOptionAttrs.map(attrs=>clean(attrs[key])).filter(Boolean))];
      if(values.length===1)product.attributes[key]=values[0];
    }
    product.attributes.manufacturer=product.manufacturer;
    product.attributes.brand=product.manufacturer;
    product.price=product.priceMin;
    delete product._strengths;
    delete product._optionLabels;
    return product;
  });

  products.sort((a,b)=>
    Number(b.available)-Number(a.available)||
    a.sortOrder-b.sortOrder||
    a.name.localeCompare(b.name,"ru")
  );

  return {
    products,
    fields:[...allFields.entries()].map(([key,label])=>({key,label})),
    sourceRows:rows.length,
    activeRows,
    productFamilies:products.length,
    variants:products.reduce((sum,product)=>sum+product.options.length,0)
  };
}

export async function loadCatalog({
  spreadsheetId=DEFAULT_SHEET_ID,
  catalogGid=DEFAULT_CATALOG_GID
}={}){
  const url="https://docs.google.com/spreadsheets/d/"+encodeURIComponent(spreadsheetId)+
    "/export?format=csv&gid="+encodeURIComponent(catalogGid);
  const response=await fetch(url,{
    headers:{Accept:"text/csv,text/plain;q=0.9,*/*;q=0.1"},
    signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw new Error("Google Sheets вернул HTTP "+response.status);
  const parsed=parseCatalogCSV(await response.text());
  return {
    source:"google-sheets",
    updatedAt:new Date().toISOString(),
    sourceRows:parsed.sourceRows,
    activeRows:parsed.activeRows,
    productFamilies:parsed.productFamilies,
    variants:parsed.variants,
    fields:parsed.fields,
    products:parsed.products
  };
}
