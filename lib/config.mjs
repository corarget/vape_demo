import { getSetting } from "./db.mjs";
import { DEFAULT_DEPLOYMENT_CONFIG, deploymentConfig, sanitizeWhiteLabelConfig } from "./white-label.mjs";

export const DEFAULT_ADMIN_APPEARANCE={
  background:"#11151D",sidebar:"#151A24",panel:"#1B2230",panel2:"#222C3C",text:"#F0F3F8",muted:"#AAB6CA",line:"#36445A",accent:"#A8C5FF",
  fontFamily:"Inter",headingFontFamily:"Manrope",radius:14,density:"comfortable",sidebarWidth:230,fontScale:100
};
export const DEFAULT_STOREFRONT_LAYOUT={showHero:true,mobileColumns:2,desktopColumns:3};
export const DEFAULT_CONFIG = {
  ...DEFAULT_DEPLOYMENT_CONFIG,
  metroEnabled:true,pickupEnabled:true,deliveryEnabled:false,slotMinutes:60,leadMinutes:60,
  daysAhead:7,slotCapacity:4,minOrder:0,deliveryFee:0,address:"",phone:"",
  ageGateEnabled:true,cashPaymentEnabled:true,transferPaymentEnabled:false,transferDetails:"",
  maxItemQuantity:10,metroMeetingHint:"",
  brandTagline:"",logoUrl:"",heroTitle:"Каталог",heroSubtitle:"Выберите то, что вам нужно",
  theme:{accent:"#E5E7EB",accent2:"#C4C9CC",background:"#101112",panel:"#191D1F",panel2:"#24292B",text:"#E8ECEF",muted:"#A0AAA4",line:"#363D3F",fontFamily:"Inter",headingFontFamily:"Manrope"},
  storefrontLayout:DEFAULT_STOREFRONT_LAYOUT,
  defaultSort:"featured",analyticsEnabled:true,
  weeklyHours:{
    mon:{open:"10:00",close:"21:00",closed:false},tue:{open:"10:00",close:"21:00",closed:false},
    wed:{open:"10:00",close:"21:00",closed:false},thu:{open:"10:00",close:"21:00",closed:false},
    fri:{open:"10:00",close:"21:00",closed:false},sat:{open:"10:00",close:"21:00",closed:false},
    sun:{open:"10:00",close:"21:00",closed:false}
  }
};

export const FONT_FAMILIES=["Inter","Open Sans","Manrope","Montserrat"];
export function sanitizeTheme(value={},base=DEFAULT_CONFIG.theme){
  const theme={...DEFAULT_CONFIG.theme,...(base||{}),...(value||{})};
  const validColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||""));
  for(const key of ["accent","accent2","background","panel","panel2","text","muted","line"])if(!validColor(theme[key]))theme[key]=DEFAULT_CONFIG.theme[key];
  if(!FONT_FAMILIES.includes(theme.fontFamily))theme.fontFamily=DEFAULT_CONFIG.theme.fontFamily;
  if(!FONT_FAMILIES.includes(theme.headingFontFamily))theme.headingFontFamily=DEFAULT_CONFIG.theme.headingFontFamily;
  return theme;
}
export function sanitizeStorefrontLayout(value,base=DEFAULT_STOREFRONT_LAYOUT){
  return {showHero:typeof value?.showHero==="boolean"?value.showHero:base.showHero,mobileColumns:[1,2].includes(value?.mobileColumns)?value.mobileColumns:base.mobileColumns,desktopColumns:[2,3,4].includes(value?.desktopColumns)?value.desktopColumns:base.desktopColumns};
}
export function storefrontAppearance(config){
  return {storeId:config.storeId,storeName:config.storeName,locale:config.locale,timezone:config.timezone,currency:config.currency,brandTagline:config.brandTagline||"",logoUrl:config.logoUrl||"",heroTitle:config.heroTitle||"Каталог",heroSubtitle:config.heroSubtitle||"",theme:config.theme,storefrontLayout:config.storefrontLayout,defaultSort:config.defaultSort||"featured",analyticsEnabled:config.analyticsEnabled!==false};
}
export function sanitizeAdminAppearance(value={}){
  const appearance={...DEFAULT_ADMIN_APPEARANCE,...(value||{})};
  const validColor=color=>/^#[0-9a-f]{6}$/i.test(String(color||""));
  for(const key of ["background","sidebar","panel","panel2","text","muted","line","accent"])if(!validColor(appearance[key]))appearance[key]=DEFAULT_ADMIN_APPEARANCE[key];
  if(!["Inter","Open Sans"].includes(appearance.fontFamily))appearance.fontFamily="Inter";
  if(!["Manrope","Montserrat"].includes(appearance.headingFontFamily))appearance.headingFontFamily="Manrope";
  appearance.radius=[10,12,14,18,22].includes(Number(appearance.radius))?Number(appearance.radius):14;
  appearance.density=appearance.density==="compact"?"compact":"comfortable";
  appearance.sidebarWidth=[200,230,260].includes(Number(appearance.sidebarWidth))?Number(appearance.sidebarWidth):230;
  appearance.fontScale=[90,100,110,120].includes(Number(appearance.fontScale))?Number(appearance.fontScale):100;
  return appearance;
}
export async function getConfig(env){
  const deployment=deploymentConfig(env);
  const saved=await getSetting(env,"store_config",{});
  const identity=sanitizeWhiteLabelConfig(saved,deployment);
  return {...DEFAULT_CONFIG,...saved,...identity,storeId:deployment.storeId,theme:sanitizeTheme(saved?.theme||{}),storefrontLayout:sanitizeStorefrontLayout(saved?.storefrontLayout),weeklyHours:{...DEFAULT_CONFIG.weeklyHours,...(saved?.weeklyHours||{})}};
}
