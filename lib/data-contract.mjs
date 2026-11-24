// Read-only data contract. No network calls or mutation.
export const ITEM_COLUMNS = Object.freeze(["product_key","sku","category","name","option_label","price_byn","image_url","available","active","manufacturer","strength_mg","variant_image_url"]);
export const CATEGORY_COLUMNS = Object.freeze(["id","name","image_url","active","sort_order","product_category"]);
const clean = v => String(v ?? "").trim();
const norm = v => clean(v).normalize("NFKC").toLowerCase().replace(/\s+/g," ");
const bool = v => ["true","false","1","0","yes","no","да","нет"].includes(norm(v));
const url = v => { if (!clean(v)) return true; try { const u=new URL(clean(v)); return u.protocol==="https:" && !!u.hostname && !u.username && !u.password; } catch { return false; } };
const decimal = v => /^\d+(?:[.,]\d{1,2})?$/.test(clean(v).replace(/\s/g,""));
export function auditData(items, categories) {
  const issues=[];
  const issue=(severity,sheet,row,field,code,relatedRow)=>issues.push({severity,sheet,row,field,code,...(relatedRow?{relatedRow}:{})});
  function records(table, required, sheet) {
    if (!Array.isArray(table)||!Array.isArray(table[0])) { issue("error",sheet,1,"","missing_header"); return []; }
    const header=table[0].map(v=>clean(v).replace(/^\uFEFF/,"").toLowerCase());
    const seen=new Set();
    for(const name of header){if(!name)issue("error",sheet,1,"","blank_header");else if(seen.has(name))issue("error",sheet,1,name,"duplicate_header");seen.add(name);}
    for(const name of required)if(!seen.has(name))issue("error",sheet,1,name,"missing_column");
    return table.slice(1).flatMap((cells,index)=> {
      if (!cells.some(v=>clean(v))) return [];
      const row=index+2;
      if(cells.length>header.length)issue("error",sheet,row,"","extra_cells");
      return [{row, data:Object.fromEntries(header.map((name,i)=>[name,clean(cells[i])]))}];
    });
  }
  const c=records(categories,CATEGORY_COLUMNS,"Категории");
  const p=records(items,ITEM_COLUMNS,"Товары");
  const ids=new Map(),names=new Map(),links=new Map(),skus=new Map(),groups=new Map(),groupIds=new Map();
  function unique(map,key,sheet,row,field){
    if(!key)return;
    if(map.has(key))issue("error",sheet,row,field,"duplicate",map.get(key));
    else map.set(key,row);
  }
  for(const {row,data:d} of c){
    const sheet="Категории";
    for(const field of ["id","name","product_category"])if(!d[field])issue("error",sheet,row,field,"required");
    if(d.id&&!/^[a-z][a-z0-9-]*$/.test(d.id))issue("error",sheet,row,"id","invalid_slug");
    if(d.id&&norm(d.id)===norm(d.name))issue("error",sheet,row,"id","equals_name");
    unique(ids,norm(d.id),sheet,row,"id");unique(names,norm(d.name),sheet,row,"name");unique(links,norm(d.product_category),sheet,row,"product_category");
    if(!url(d.image_url))issue("error",sheet,row,"image_url","invalid_https_url");
    if(!bool(d.active))issue("error",sheet,row,"active","invalid_boolean");
    if(!/^\d+$/.test(d.sort_order??"")||!Number.isSafeInteger(Number(d.sort_order)))issue("error",sheet,row,"sort_order","invalid_integer");
  }
  const exactLinks=new Set(c.map(x=>x.data.product_category));
  for(const {row,data:d} of p){
    const sheet="Товары";
    for(const field of ["product_key","sku","category","name"])if(!d[field])issue("error",sheet,row,field,"required");
    unique(skus,norm(d.sku),sheet,row,"sku");
    if(d.category&&!exactLinks.has(d.category))issue("error",sheet,row,"category","unknown_category");
    if(!decimal(d.price_byn)||!Number.isSafeInteger(Math.round(Number(clean(d.price_byn).replace(/\s/g,"").replace(",","."))*100)))issue("error",sheet,row,"price_byn","invalid_price");
    for(const field of ["available","active"])if(!bool(d[field]))issue("error",sheet,row,field,"invalid_boolean");
    for(const field of ["image_url","variant_image_url"])if(!url(d[field]))issue("error",sheet,row,field,"invalid_https_url");
    if(d.product_key&&d.category&&d.name){
      const key=norm(d.product_key),group=JSON.stringify([norm(d.category),norm(d.manufacturer),norm(d.name),norm(d.component_type)]);
      const prior=groups.get(key),reverse=groupIds.get(group);
      if(prior&&prior.group!==group)issue("error",sheet,row,"product_key","group_key_conflict",prior.row);
      else if(!prior)groups.set(key,{group,row});
      if(reverse&&reverse.key!==key)issue("error",sheet,row,"product_key","multiple_group_keys",reverse.row);
      else if(!reverse)groupIds.set(group,{key,row});
    }
  }
  return {ok:!issues.some(x=>x.severity==="error"),counts:{items:p.length,categories:c.length,groups:groups.size,uniqueSkus:skus.size},issues};
}
