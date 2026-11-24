const DEFAULT_SHEET_ID = "";
const DEFAULT_CATALOG_GID = "";

const HEADER_ALIASES = {
  product_id:"product_key", productid:"product_key", id:"product_key",
  sku_id:"sku", variant_sku:"sku", article:"sku", ��⨪�:"sku",
  category_name:"category", ��⥣���:"category",
  category_title:"category_label", category_display_name:"category_label", category_label_ru:"category_label",
  category_image:"category_image_url", category_photo:"category_image_url", category_icon_emoji:"category_icon",
  product_name:"name", title:"name", ��������:"name", ⮢��:"name",
  variant:"option_label", variant_name:"option_label", option:"option_label",
  flavor:"option_label", taste:"option_label", ����:"option_label",
  price:"price_byn", price_by:"price_byn", 業�:"price_byn",
  in_stock:"available", stock:"available", ����稥:"available",
  is_active:"active", enabled:"active", ��⨢��:"active",
  image:"image_url", photo:"image_url", photo_url:"image_url", ��:"image_url",
  option_image_url:"variant_image_url", color_image_url:"variant_image_url",
  ���ᠭ��:"description", priority:"sort_order", order:"sort_order",
  brand:"manufacturer", vendor:"manufacturer", producer:"manufacturer",
  manufacturer_name:"manufacturer", �७�:"manufacturer", �ந�����⥫�:"manufacturer",
  strength:"strength_mg", nicotine_strength:"strength_mg", �९����:"strength_mg",
  resistance:"resistance_ohm", ohm:"resistance_ohm", ᮯ�⨢�����:"resistance_ohm",
  type:"component_type", component:"component_type", ⨯:"component_type",
  colour:"color", 梥�:"color"
};

const CORE_FIELDS = new Set([
  "product_key","sku","category","category_label","category_image_url","category_icon","name","option_label","price_byn","available",
  "active","image_url","variant_image_url","description","sort_order","popularity","manufacturer",
  "strength_mg","resistance_ohm","component_type","color"
]);

const FIELD_LABELS = {
  manufacturer:"�७�",
  strength_mg:"�९����",
  resistance_ohm:"����⨢�����",
  component_type:"���",
  color:"����",
  brand_line:"�������",
  volume:"����",
  volume_ml:"����",
  size:"������",
  material:"���ਠ�",
  weight:"���",
  warranty:"��࠭��",
  country_of_origin:"��࠭� �ந�����⢠",
  tags:"����",
  badge:"��⪠",
  is_new:"�������"
};

export function normalizeHeader(value) {
  const normalized=String(value??"").replace(/^\uFEFF/,"").trim().toLowerCase()
    .replace(/[\s\-./]+/g,"_").replace(/[^\p{L}\p{N}_]/gu,"");
  return HEADER_ALIASES[normalized]||normalized;
}
function clean(value){return String(value??"").trim();}
function norm(value){return clean(value).toLocaleLowerCase("ru").replace(/\s+/g," ");}
const BRAND_ALIASES=new Map([["glitch","Glitch Sauce"],["dogswiil","Dogswill"],["dogswill","Dogswill"],["liquid",""],["�� 㪠���",""]]);
function displayBrand(value){return BRAND_ALIASES.get(norm(value))??clean(value);}
function parseBoolean(value,fallback){
  const text=clean(value).toLowerCase();
  if(!text)return fallback;
  if(["true","1","yes","y","��","����","� ����稨","available"].includes(text))return true;
  if(["false","0","no","n","���","���������","��� � ����稨","unavailable"].includes(text))return false;
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
    norm(row.category)||"��㣮�",
    norm(row.manufacturer)||"��� �७��",
    norm(row.name)||"��� ��������",
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
  if(quoted)throw new Error("� CSV �����㦥�� �������⮥ ���� � ����窠�");
  row.push(cell);if(row.some(value=>String(value).trim()!==""))rows.push(row);
  return rows;
}

export function parseCatalogCSV(csvText,{columnMapping={}}={}){
  if(!csvText||/^\s*</.test(csvText))throw new Error("Google Sheets ���� �� CSV. �஢���� ����� � ⠡���");
  const rows=parseCSV(csvText);
  const rawHeaders=rows.shift();
  if(!rawHeaders?.length)throw new Error("� ���� Catalog ��� ��ப� ����������");
  const mapping=new Map(Object.entries(columnMapping||{}).filter(([,source])=>String(source||"").trim()).map(([field,source])=>[String(source).trim().toLocaleLowerCase("ru"),field]));
  const headers=rawHeaders.map(raw=>mapping.get(String(raw??"").trim().toLocaleLowerCase("ru"))||normalizeHeader(raw));
  const headerSet=new Set(headers);
  for(const required of ["name","category","price_byn"]){
    if(!headerSet.has(required))throw new Error("� ���� Catalog ��������� ��易⥫�� �⮫���: "+required);
  }
  if(!headerSet.has("product_key")&&!headerSet.has("sku"))throw new Error("�㦥� �⮫��� product_key ��� sku - 㭨����� ID ��ਠ��");

  const families=new Map();
  const allFields=new Map();
  let activeRows=0;
  const categories=new Map();
  rows.forEach((values,rowIndex)=>{
    const row={};
    headers.forEach((header,columnIndex)=>{if(header)row[header]=clean(values[columnIndex]);});
    const productKey=clean(row.product_key)||clean(row.sku);
    if(!productKey||!parseBoolean(row.active,true))return;
    activeRows++;
    const categoryKey=clean(row.category)||"��㣮�";
    const categoryEntry=categories.get(categoryKey)||{key:categoryKey,label:categoryKey,image:"",icon:""};
    if(clean(row.category_label))categoryEntry.label=clean(row.category_label);
    if(!categoryEntry.image&&row.category_image_url)categoryEntry.image=safeImageUrl(row.category_image_url);
    if(clean(row.category_icon))categoryEntry.icon=clean(row.category_icon).slice(0,8);
    categories.set(categoryKey,categoryEntry);

    const key=familyKey(row);
    const price=parsePrice(row.price_byn);
    const sortOrder=parseNumber(row.sort_order);
    const popularity=parseNumber(row.popularity);
    let product=families.get(key);
    if(!product){
      product={
        id:familyId(key),
        category:clean(row.category)||"��㣮�",
        name:clean(row.name)||productKey,
        manufacturer:displayBrand(row.manufacturer),
        brand:displayBrand(row.manufacturer),
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
    const baseLabel=clean(row.option_label)||clean(row.color)||clean(row.resistance_ohm)||"�᭮���� ��ਠ��";
    product._optionLabels.add(baseLabel);
    const option={
      variantId:productKey,
      productKey,
      sku:clean(row.sku),
      label:baseLabel,
      available:parseBoolean(row.available,false),
      price,
      image:safeImageUrl(row.variant_image_url)||safeImageUrl(row.image_url),
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
    const keyCounts=new Map(),skuCounts=new Map();
    for(const {productKey,sku} of product.options){
      keyCounts.set(productKey,(keyCounts.get(productKey)||0)+1);
      if(sku)skuCounts.set(sku,(skuCounts.get(sku)||0)+1);
    }
    const variantIds=new Set(keyCounts.keys());
    product.options=product.options.map((option,index)=>{
      const strength=option.attributes.strength_mg;
      const label=hasMultipleStrengths&&strength?option.label+" � "+strength+" ��":option.label;
      let variantId=option.productKey;
      if(keyCounts.get(option.productKey)>1){
        const uniqueSku=option.sku&&skuCounts.get(option.sku)===1&&!variantIds.has(option.sku);
        variantId=uniqueSku?option.sku:option.productKey+"@"+index;
        while(variantIds.has(variantId))variantId+="@";
        variantIds.add(variantId);
      }
      return {...option,variantId,label};
    });
    product.options.sort((a,b)=>
      Number(b.available)-Number(a.available)||
      a.sortOrder-b.sortOrder||
      a.label.localeCompare(b.label,"ru")
    );
    if(norm(product.name)==="musthave 25g"){
      const raspberryIds=new Set(["SKU-04320","SKU-04329"]);
      const duplicateOptions=product.options.filter(option=>raspberryIds.has(option.sku));
      if(duplicateOptions.length===2&&duplicateOptions[0].price===duplicateOptions[1].price&&duplicateOptions[0].label===duplicateOptions[1].label){
        const [retained,duplicate]=duplicateOptions;
        retained.legacyVariantIds=[duplicate.variantId];
        product.options=product.options.filter(option=>option!==duplicate);
      }
    }

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
    categories:[...categories.values()],
    sourceRows:rows.length,
    activeRows,
    productFamilies:products.length,
    variants:products.reduce((sum,product)=>sum+product.options.length,0)
  };
}

export function parseCategoriesCSV(csvText){
  if(!csvText||/^\s*</.test(csvText))return [];
  const rows=parseCSV(csvText);
  const headers=(rows.shift()||[]).map(normalizeHeader);
  const categories=[],keys=new Set(),labels=new Set();
  for(const values of rows){
    const row={};headers.forEach((header,index)=>{if(header)row[header]=clean(values[index]);});
    const key=clean(row.category_key||row.category||row.key||row.id);
    if(!key)continue;
    const label=clean(row.label||row.category_label||row.name)||key;
    const normalizedKey=norm(key),normalizedLabel=norm(label);
    if(keys.has(normalizedKey))throw new Error("� ���� <��⥣�ਨ> ��������� ID: "+key);
    if(labels.has(normalizedLabel))throw new Error("� ���� <��⥣�ਨ> ��������� ��������: "+label);
    const rawImage=clean(row.image_url||row.category_image_url||row.image);
    if(rawImage&&!safeImageUrl(rawImage))throw new Error("� ���� <��⥣�ਨ> �����४�� HTTPS URL: "+rawImage);
    keys.add(normalizedKey);labels.add(normalizedLabel);
    categories.push({
      key,
      label,
      image:safeImageUrl(rawImage),
      icon:clean(row.icon||row.category_icon).slice(0,48),
      color:/^#[0-9a-f]{6}$/i.test(clean(row.color))?clean(row.color):"#D8DDE0",
      active:parseBoolean(row.active,true),
      description:clean(row.description).slice(0,300),
      showDescription:parseBoolean(row.show_description,false),
      sortOrder:parseNumber(row.sort_order)??categories.length
    });
  }
  return categories.sort((a,b)=>a.sortOrder-b.sortOrder||a.label.localeCompare(b.label,"ru"));
}

export async function loadCatalog({
  spreadsheetId=DEFAULT_SHEET_ID,
  catalogGid=DEFAULT_CATALOG_GID,
  categoriesGid="",
  columnMapping={}
}={}){
  const url="https://docs.google.com/spreadsheets/d/"+encodeURIComponent(spreadsheetId)+
    "/export?format=csv&gid="+encodeURIComponent(catalogGid);
  const response=await fetch(url,{
    headers:{Accept:"text/csv,text/plain;q=0.9,*/*;q=0.1"},
    signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw new Error("Google Sheets ���� HTTP "+response.status);
  const parsed=parseCatalogCSV(await response.text(),{columnMapping});
  if(categoriesGid){
    const categoriesUrl="https://docs.google.com/spreadsheets/d/"+encodeURIComponent(spreadsheetId)+
      "/export?format=csv&gid="+encodeURIComponent(categoriesGid);
    const categoriesResponse=await fetch(categoriesUrl,{headers:{Accept:"text/csv,text/plain;q=0.9,*/*;q=0.1"},signal:AbortSignal.timeout(15000)});
    if(!categoriesResponse.ok)throw new Error("Google Sheets categories HTTP "+categoriesResponse.status);
    const categories=parseCategoriesCSV(await categoriesResponse.text());
    if(categories.length)parsed.categories=categories;
  }
  return {
    source:"google-sheets",
    updatedAt:new Date().toISOString(),
    sourceRows:parsed.sourceRows,
    activeRows:parsed.activeRows,
    productFamilies:parsed.productFamilies,
    variants:parsed.variants,
    fields:parsed.fields,
    categories:parsed.categories,
    products:parsed.products
  };
}

