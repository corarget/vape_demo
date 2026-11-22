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
      return option.available&&option.price>0&&Number.isFinite(strength)&&strength>0&&!/(?:^|\s)0\s*мг(?:\s|$)/iu.test(product.name);
    }).map(option=>({product,option})));
}

export function highestPromotion(rules, items){
  return rules.filter(rule=>rule.active&&items.reduce((quantity,item)=>quantity+(rule.groups.includes(item.promotionGroup)?item.quantity:0),0)>=rule.minimum)
    .sort((a,b)=>b.minimum-a.minimum)[0];
}

export function normalizePromotion(input, id){
  const title=String(input?.title||"").trim().slice(0,80);
  const description=String(input?.description||"").trim().slice(0,300);
  const giftLabel=String(input?.giftLabel||"").trim().slice(0,100);
  const giftBrand=String(input?.giftBrand||"").trim().slice(0,80);
  const minimum=Number(input?.minimum);
  const groups=Array.isArray(input?.groups)?[...new Set(input.groups.filter(group=>GROUPS.has(group)))]:[];
  if(!title||!description||!giftLabel||!Number.isInteger(minimum)||minimum<1||minimum>99||!groups.length)return null;
  return {id,title,description,minimum,groups,giftLabel,giftBrand,active:input.active===true};
}
