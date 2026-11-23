const GROUPS = new Set(["liquid", "coil", "cartridge"]);

export const DEMO_PROMOTIONS = [
  {id:"demo-two",title:"1+1=3",description:"При покупке двух жидкостей, испарителей или картриджей — случайный флакон salt в подарок.",minimum:2,groups:[...GROUPS],giftLabel:"Случайный флакон salt",giftBrand:"",active:true},
  {id:"demo-three",title:"1+2=4",description:"При покупке трёх жидкостей, испарителей или картриджей — флакон Glitch Sauce Salt в подарок.",minimum:3,groups:[...GROUPS],giftLabel:"Glitch Sauce Salt",giftBrand:"Glitch Sauce",active:true}
];

export function promotionGroup(product, option){
  if(product.category==="Жидкости")return "liquid";
  if(product.category!=="Расходники")return "";
  const type=String(option?.attributes?.component_type||product.attributes?.component_type||product.name).trim();
  if(/^(испарител|coil)/iu.test(type))return "coil";
  if(/^(картридж|cartridge|pod)/iu.test(type))return "cartridge";
  return "";
}

export function promotionGiftOptions(products, rule){
  const brand=rule.giftBrand.toLowerCase();
  return products.filter(product=>product.category==="Жидкости"&&(!brand||product.manufacturer.toLowerCase()===brand))
    .flatMap(product=>product.options.filter(option=>{
      const strength=Number(String(option.attributes?.strength_mg??"").replace(",", "."));
      const saltMarked=/(?:salt|солев)/iu.test([product.name,option.label,option.attributes?.nicotine_type,option.attributes?.liquid_type].filter(Boolean).join(" "));
      return option.available&&option.price>0&&(saltMarked||(Number.isFinite(strength)&&strength>=20))&&!/(?:^|\s)0\s*мг(?:\s|$)/iu.test(product.name);
    }).map(option=>({product,option})));
}

export function highestPromotion(rules, items){
  return rules.filter(rule=>rule.type!=="discount"&&rule.active&&items.reduce((quantity,item)=>quantity+(rule.groups.includes(item.promotionGroup)?item.quantity:0),0)>=rule.minimum)
    .sort((a,b)=>b.minimum-a.minimum)[0];
}

export function discountForProduct(rules, product, option={}){
  const matches=(rules||[]).filter(rule=>{
    if(!rule?.active||rule.type!=="discount")return false;
    if(rule.scope==="catalog")return true;
    const targets=(rule.targets||[]).map(value=>String(value).trim().toLowerCase()).filter(Boolean);
    if(rule.scope==="category")return targets.includes(String(product.category||"").trim().toLowerCase());
    const values=[product.id,product.name,option.variantId,option.productKey,option.sku].map(value=>String(value||"").trim().toLowerCase());
    return targets.some(target=>values.includes(target));
  });
  return matches.reduce((best,rule)=>Number(rule.discountPercent)>Number(best?.discountPercent||0)?rule:best,null);
}

export function applyCatalogDiscounts(payload, rules){
  for(const product of payload?.products||[]){
    for(const option of product.options||[]){
      const rule=discountForProduct(rules,product,option);
      if(!rule)continue;
      const originalPrice=Number(option.price||0);
      option.originalPrice=originalPrice;
      option.price=Math.max(0,Math.round(originalPrice*(100-rule.discountPercent)/100));
      option.discount={id:rule.id,title:rule.title,percent:rule.discountPercent};
    }
    const prices=(product.options||[]).map(option=>Number(option.price||0)).filter(Number.isFinite);
    if(prices.length)product.price=Math.min(...prices);
  }
  return payload;
}

export function normalizePromotion(input, id){
  const title=String(input?.title||"").trim().slice(0,80);
  const description=String(input?.description||"").trim().slice(0,300);
  if(input?.type==="discount"){
    const discountPercent=Number(input?.discountPercent);
    const scope=["catalog","category","product"].includes(input?.scope)?input.scope:"catalog";
    const targets=Array.isArray(input?.targets)?[...new Set(input.targets.map(value=>String(value).trim().slice(0,180)).filter(Boolean))]:[];
    if(!title||!description||!Number.isInteger(discountPercent)||discountPercent<1||discountPercent>99||((scope==="category"||scope==="product")&&!targets.length))return null;
    return {id,type:"discount",title,description,discountPercent,scope,targets,active:input.active===true};
  }
  const giftLabel=String(input?.giftLabel||"").trim().slice(0,100);
  const giftBrand=String(input?.giftBrand||"").trim().slice(0,80);
  const minimum=Number(input?.minimum);
  const groups=Array.isArray(input?.groups)?[...new Set(input.groups.filter(group=>GROUPS.has(group)))]:[];
  if(!title||!description||!giftLabel||!Number.isInteger(minimum)||minimum<1||minimum>99||!groups.length)return null;
  return {id,type:"gift",title,description,minimum,groups,giftLabel,giftBrand,active:input.active===true};
}

