import { COOKIE, json, textResponse, parseCookie, cookieHeader, clearCookie, validOrigin, bodyJson } from "./lib/http.mjs";
import { now, randomId, randomToken, sha256, safeEqual } from "./lib/crypto.mjs";
import { operationalEvent } from "./lib/operational-safety.mjs";
import { first, all, run, logSystem, getSetting, setSetting } from "./lib/db.mjs";
import { DEFAULT_ADMIN_APPEARANCE, DEFAULT_CONFIG, sanitizeTheme, sanitizeStorefrontLayout, storefrontAppearance, sanitizeAdminAppearance, getConfig } from "./lib/config.mjs";
import { PERMISSION_KEYS, normalizePermissions, permissionsFromStorage, getStaff, isManager, permissionForAdminRoute, hasPermission, unauthorized, createSession } from "./lib/auth.mjs";
import { loadCatalog, parseCSV } from "./catalog.mjs";
import { redeemStaffCredential } from "./lib/staff-redemption.mjs";
import { reserveLoginAttempt, loginRateLimited } from "./lib/login-limit.mjs";
import { resolveDemoOwner } from "./lib/demo-owner.mjs";
import { verifyTelegramInitData, customerOrderScope } from "./lib/telegram-auth.mjs";
import { BASELINE_KEY, readCSV, buildAuditSnapshot, diffAuditSnapshots, probeAppsScript } from "./lib/sync-audit.mjs";
import { DEMO_PROMOTIONS, applyCatalogDiscounts, discountForProduct, highestPromotion, normalizePromotion, promotionGiftOptions, promotionGroup } from "./promotions.mjs";
import { html } from "./site.mjs";
import { adminHtml } from "./admin.mjs";

const storefrontHtml=html;
const VERSION = "2.7.1";
const STATUS_LABELS = {
  new:"Новый", confirmed:"Подтверждён", preparing:"Готовится", ready:"Готов",
  assigned:"Назначен курьер", picked_up:"Забран курьером", on_the_way:"В пути",
  delivered:"Доставлен", completed:"Завершён", cancelled:"Отменён", rejected:"Отклонён"
};
const ACTIVE_STATUSES = ["new","confirmed","preparing","ready","assigned","picked_up","on_the_way"];

async function storeConfigRevision(env){
  const row=await first(env,"SELECT updated_at FROM settings WHERE key='store_config'");
  return row?.updated_at||"";
}
async function saveStoreConfig(env,value,staffId,expectedRevision){
  const revision=now();
  const result=await run(env,"UPDATE settings SET value_json=?,updated_at=?,updated_by=? WHERE key='store_config' AND updated_at=?",
    [JSON.stringify(value),revision,staffId,String(expectedRevision||"")]);
  return result.meta?.changes?revision:null;
}

function normalizePromoCode(value){return String(value||"").trim().toUpperCase().replace(/\s+/g,"");}
function normalizePromocode(input,id){
  const code=normalizePromoCode(input?.code),title=String(input?.title||"").trim().slice(0,80);
  const type=input?.type==="fixed"?"fixed":"percent";
  const rawValue=Number(input?.value),minimum=Math.max(0,Math.round(Number(input?.minimumAmount)||0));
  const maxUses=Math.max(0,Math.min(100000,Math.round(Number(input?.maxUses)||0)));
  const value=type==="fixed"?Math.round(rawValue*100):Math.round(rawValue);
  if(!/^[A-Z0-9_-]{3,30}$/.test(code)||!title||!Number.isFinite(value)||value<1||(type==="percent"&&value>99)||(type==="fixed"&&value>10000000))return null;
  return {id,code,title,type,value,minimumAmount:minimum,maxUses,active:input?.active===true};
}
async function getPromocodes(env){return getSetting(env,"promocodes",[]);}
async function promocodeDiscount(env,code,subtotal){
  const normalized=normalizePromoCode(code);if(!normalized)return {promo:null,discount:0};
  const promo=(await getPromocodes(env)).find(item=>item.active&&item.code===normalized);
  if(!promo)return {error:"Промокод не найден или больше не действует"};
  if(subtotal<Number(promo.minimumAmount||0))return {error:"Для этого промокода нужна сумма от "+(Number(promo.minimumAmount||0)/100).toFixed(2).replace(".",",")+" BYN"};
  if(promo.maxUses>0){
    const used=await first(env,"SELECT COUNT(*) AS count FROM order_events WHERE event_type='promo_code_applied' AND metadata_json LIKE ?",['%"code":"'+promo.code+'"%']);
    if(Number(used?.count||0)>=promo.maxUses)return {error:"Лимит использования промокода закончился"};
  }
  const discount=promo.type==="percent"?Math.round(subtotal*promo.value/100):Math.min(subtotal,promo.value);
  return {promo,discount};
}
async function loadOrder(env,id){
  const order=await first(env,"SELECT o.*,s.display_name AS courier_name FROM orders o LEFT JOIN staff s ON s.id=o.courier_id WHERE o.id=?",[id]);
  if(!order)return null;
  order.items=await all(env,"SELECT product_id,product_key,sku,product_name,manufacturer,option_label,attributes_json,quantity,unit_price,line_total FROM order_items WHERE order_id=? ORDER BY id",[id]);
  order.items=order.items.map(item=>({...item,attributes:JSON.parse(item.attributes_json||"{}")}));
  order.events=await all(env,"SELECT actor_role,event_type,from_status,to_status,message,created_at FROM order_events WHERE order_id=? ORDER BY created_at",[id]);
  return order;
}
function customerOrder(order){
  const showTransferDetails=order.payment_method==="transfer"&&
    !["new","cancelled","rejected"].includes(order.status)&&order.payment_status==="unpaid";
  return {
    id:order.id,number:order.number,status:order.status,statusLabel:STATUS_LABELS[order.status]||order.status,
    customerName:order.customer_name,deliveryMethod:order.fulfillment_method||order.delivery_method,address:order.address,doorbell:order.doorbell||"",
    slotDate:order.slot_date,slotTime:order.slot_time,comment:order.comment,total:order.total,
    currency:order.currency,deliveryFee:Number(order.delivery_fee||0),paymentMethod:order.payment_method,paymentStatus:order.payment_status,
    transferDetails:showTransferDetails?order.transfer_details||"":"",
    createdAt:order.created_at,updatedAt:order.updated_at,
    items:order.items.map(item=>({name:item.product_name,brand:item.manufacturer,variant:item.option_label,quantity:item.quantity,unitPrice:item.unit_price,lineTotal:item.line_total})),
    events:order.events.map(event=>({type:event.event_type,status:event.to_status,message:event.message,createdAt:event.created_at}))
  };
}
function adminOrder(order){
  return {
    ...customerOrder(order),
    phone:order.phone||"",telegramUsername:order.telegram_username||"",telegramLinked:!!order.telegram_user_id,
    courierId:order.courier_id,courierName:order.courier_name,
    managerId:order.manager_id,cancelReason:order.cancel_reason,
    items:order.items.map(item=>({...item,attributes:JSON.parse(item.attributes_json||"{}")})),
    events:order.events
  };
}
function statusMessage(status){
  const messages={
    confirmed:"Заказ подтверждён магазином.",
    preparing:"Заказ собирается.",
    ready:"Заказ готов. Можно забирать.",
    assigned:"К заказу назначен курьер.",
    picked_up:"Курьер забрал заказ.",
    on_the_way:"Заказ уже в пути.",
    delivered:"Заказ доставлен. Спасибо!",
    completed:"Заказ завершён.",
    rejected:"Магазин не смог принять заказ.",
    cancelled:"Заказ отменён."
  };
  return messages[status]||"Статус заказа обновлён.";
}
async function telegramCall(env,method,payload){
  if(!env.BOT_TOKEN)return {ok:false,description:"BOT_TOKEN не настроен"};
  const response=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/"+method,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
  });
  const data=await response.json().catch(()=>({ok:false,description:"Invalid Telegram response"}));
  if(!response.ok||!data.ok)throw new Error(data.description||("Telegram API HTTP "+response.status));
  return data;
}
async function sendTelegram(env,chatId,message,replyMarkup=null){
  if(!env.BOT_TOKEN||!chatId)return;
  try{
    await telegramCall(env,"sendMessage",{
      chat_id:chatId,text:message,parse_mode:"HTML",disable_web_page_preview:true,
      ...(replyMarkup?{reply_markup:replyMarkup}:{})
    });
  }catch(error){
    await logSystem(env,"warning","telegram","Не удалось отправить уведомление Telegram",{});
  }
}
async function notifyOrder(env,order,status="new"){
  const managerChatId=String(await getSetting(env,"manager_chat_id","")||"");
  if(status==="new"){
    const lines=order.items.map(item=>" "+escapeTelegram(item.product_name)+" / "+escapeTelegram(item.option_label)+" ? "+item.quantity).join("\n");
    const message="<b>Новый заказ #"+order.number+"</b>\n"+
      "Покупатель: "+escapeTelegram(order.customer_name)+"\n"+
      (order.phone?"Телефон: "+escapeTelegram(order.phone)+"\n":"")+
      (order.telegram_username?"Telegram: @"+escapeTelegram(order.telegram_username)+"\n":"")+
      "Способ: "+({metro:"Метро",pickup:"Самовывоз",delivery:"Доставка на дом"}[order.fulfillment_method||order.delivery_method]||"Самовывоз")+"\n"+
      "Время: "+order.slot_date+" "+order.slot_time+"\n"+
      (order.address?"Адрес: "+escapeTelegram(order.address)+"\n":"")+
      (order.doorbell?"Домофон: "+escapeTelegram(order.doorbell)+"\n":"")+
      lines+"\nИтого: "+(order.total/100).toFixed(2)+" BYN";
    const keyboard={inline_keyboard:[[
      {text:"Подтвердить",callback_data:"order|"+order.id+"|confirmed"},
      {text:"Отклонить",callback_data:"order|"+order.id+"|rejected"}
    ]]};
    await sendTelegram(env,managerChatId,message,keyboard);
  }else{
    if(order.telegram_user_id)await sendTelegram(env,order.telegram_user_id,"<b>Заказ #"+order.number+"</b>\n"+statusMessage(status));
    if(order.courier_id){
      const courier=await first(env,"SELECT telegram_id,display_name FROM staff WHERE id=?",[order.courier_id]);
      if(courier?.telegram_id&&status==="assigned"){
        await sendTelegram(env,courier.telegram_id,"<b>Новая доставка #"+order.number+"</b>\n"+
          "Клиент: "+escapeTelegram(order.customer_name)+
          "\nАдрес: "+escapeTelegram(order.address||"")+"\nВремя: "+order.slot_date+" "+order.slot_time);
      }
    }
  }
}
function escapeTelegram(value){
  return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function timeParts(date,timezone){
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",weekday:"short",hourCycle:"h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map(part=>[part.type,part.value]));
}
function minutesOf(time){
  const match=/^(\d{2}):(\d{2})$/.exec(String(time||""));
  return match?Number(match[1])*60+Number(match[2]):-1;
}
function formatMinutes(value){
  return String(Math.floor(value/60)).padStart(2,"0")+":"+String(value%60).padStart(2,"0");
}
function weekdayKey(short){
  return ({Mon:"mon",Tue:"tue",Wed:"wed",Thu:"thu",Fri:"fri",Sat:"sat",Sun:"sun"})[short]||"mon";
}
function dateDifference(a,b){
  const parse=value=>Date.UTC(Number(value.slice(0,4)),Number(value.slice(5,7))-1,Number(value.slice(8,10)));
  return Math.round((parse(a)-parse(b))/86400000);
}
function slotDateError(date,method,config){
  if(!["metro","pickup","delivery"].includes(method))return "Неизвестный способ получения";
  const parsed=new Date(date+"T12:00:00Z");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(+parsed)||parsed.toISOString().slice(0,10)!==date)return "Укажите корректную дату";
  const current=timeParts(new Date(),config.timezone||"Europe/Minsk");
  const diff=dateDifference(date,current.year+"-"+current.month+"-"+current.day);
  if(diff<0||diff>Number(config.daysAhead||7))return "Дата вне доступного периода записи";
  return "";
}
function nextCalendarDate(date,days){
  const value=new Date(date+"T12:00:00Z");
  value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
}
async function getSlots(env,date,method,config){
  config??=await getConfig(env);
  if(slotDateError(date,method,config))return [];
  if(method==="metro"&&config.metroEnabled===false)return [];
  if(method==="pickup"&&!config.pickupEnabled)return [];
  if(method==="delivery"&&!config.deliveryEnabled)return [];
  const current=timeParts(new Date(),config.timezone||"Europe/Minsk");
  const today=current.year+"-"+current.month+"-"+current.day;
  const diff=dateDifference(date,today);
  if(diff<0||diff>Number(config.daysAhead||7))return [];
  const weekday=weekdayKey(new Intl.DateTimeFormat("en-GB",{timeZone:config.timezone,weekday:"short"}).format(new Date(date+"T12:00:00Z")));
  const hours=config.weeklyHours?.[weekday];
  if(!hours||hours.closed)return [];
  const open=minutesOf(hours.open),close=minutesOf(hours.close),step=Math.max(15,Math.min(240,Number(config.slotMinutes)||60));
  if(open<0||close<=open)return [];
  const blocks=await all(env,"SELECT start_time,end_time,method FROM slot_blocks WHERE slot_date=?",[date]);
  const orders=await all(env,
    "SELECT slot_time,COUNT(*) AS booked FROM orders WHERE slot_date=? AND COALESCE(fulfillment_method,delivery_method)=? AND status NOT IN ('cancelled','rejected') GROUP BY slot_time",
    [date,method]);
  const bookedMap=new Map(orders.map(row=>[row.slot_time,Number(row.booked)]));
  const result=[];
  for(let start=open;start+step<=close;start+=step){
    if(diff===0&&start<Number(current.hour)*60+Number(current.minute)+Number(config.leadMinutes||0))continue;
    const end=start+step;
    const blocked=blocks.some(block=>(block.method==="all"||block.method===method)&&
      start<minutesOf(block.end_time||"23:59")&&end>minutesOf(block.start_time||"00:00"));
    if(blocked)continue;
    const time=formatMinutes(start);
    const booked=bookedMap.get(time)||0;
    const capacity=Math.max(1,Number(config.slotCapacity)||4);
    if(booked<capacity)result.push({time,booked,capacity,available:capacity-booked});
  }
  return result;
}
async function getCatalogConfig(env){
  const saved=await getSetting(env,"catalog_config",{});
  return {
    spreadsheetId:String(saved.spreadsheetId||env.GOOGLE_SHEET_ID||""),
    catalogGid:String(saved.catalogGid||env.GOOGLE_CATALOG_GID||""),
    cacheSeconds:Math.max(60,Math.min(240,Number(saved.cacheSeconds)||90)),
    categoriesGid:String(saved.categoriesGid||env.GOOGLE_CATEGORIES_GID||""),
    columnMapping:saved.columnMapping&&typeof saved.columnMapping==="object"?saved.columnMapping:{}
  };
}
async function readCatalog(env){
  const catalogConfig=await getCatalogConfig(env);
  if(!catalogConfig.spreadsheetId||!catalogConfig.catalogGid)throw new Error("Подключите Google Sheets в админке → Каталог");
  return loadCatalog({spreadsheetId:catalogConfig.spreadsheetId,catalogGid:catalogConfig.catalogGid,columnMapping:catalogConfig.columnMapping||{}});
}
// The baseline and its corresponding successful history row are committed atomically.
// An optimistic compare-and-swap prevents overlapping requests from losing a baseline.
async function syncCatalog(env){
  const id=randomId(),started=now();
  await run(env,"INSERT INTO sync_runs(id,status,started_at,details_json) VALUES(?,?,?,?)",[id,"running",started,JSON.stringify({manual:true})]);
  try{
    const config=await getCatalogConfig(env);
    const initial=await first(env,"SELECT value_json,updated_by FROM settings WHERE key=?",[BASELINE_KEY]);
    const [itemCSV,categoryCSV]=await Promise.all([readCSV(config,config.catalogGid),readCSV(config,config.categoriesGid)]);
    const {payload,snapshot,warnings}=await buildAuditSnapshot(itemCSV,categoryCSV,config);
    const integration=await probeAppsScript(env,config);
    const current=await getCatalogConfig(env);
    if(JSON.stringify(current)!==JSON.stringify(config))throw Error("Настройки источника изменились во время проверки. Запустите её повторно.");
    const expected=initial?.value_json??null;
    const changes=diffAuditSnapshots(expected===null?null:JSON.parse(expected),snapshot);
    const details={manual:true,source:payload.source,changes,warnings,integration};
    const finished=now(),next=JSON.stringify(snapshot);
    if(new TextEncoder().encode(next).byteLength>1800000)throw Error("Снимок превышает допустимый размер. Базовый снимок не изменён.");
    const baselineStatement=env.DB.prepare("INSERT INTO settings(key,value_json,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by WHERE settings.value_json=? AND settings.updated_by=?")
      .bind(BASELINE_KEY,next,finished,id,expected,initial?.updated_by??null);
    // Check the generation as well as content: simultaneous no-change runs must not overwrite history.
    const historyStatement=env.DB.prepare("UPDATE sync_runs SET status='success',finished_at=?,source_rows=?,product_families=?,variants=?,details_json=? WHERE id=? AND EXISTS (SELECT 1 FROM settings WHERE key=? AND updated_by=?)")
      .bind(finished,payload.sourceRows,payload.productFamilies,payload.variants,JSON.stringify(details),id,BASELINE_KEY,id);
    const results=await env.DB.batch([baselineStatement,historyStatement]);
    if(results[0]?.meta?.changes!==1||results[1]?.meta?.changes!==1)throw Error("Параллельная проверка уже обновила снимок. Запустите синхронизацию повторно.");
    await logSystem(env,"info","catalog","Проверка источника завершена",{rows:payload.sourceRows,changes,integration});
    return {sourceRows:payload.sourceRows,activeRows:payload.activeRows,productFamilies:payload.productFamilies,variants:payload.variants,updatedAt:payload.updatedAt,changes,warnings,integration};
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await run(env,"UPDATE sync_runs SET status='error',finished_at=?,error=? WHERE id=? AND status='running'",[now(),message.slice(0,500),id]);
    await logSystem(env,"error","catalog","Ошибка проверки источника",{error:message.slice(0,500)});
    throw new Error(message);
  }
}
function publicCatalog(payload){
  return {
    source:payload.source,updatedAt:payload.updatedAt,
    sourceRows:payload.sourceRows,productFamilies:payload.productFamilies,variants:payload.variants,
    products:payload.products.map(product=>({
      id:product.id,category:product.category,name:product.name,
      manufacturer:product.manufacturer,brand:product.brand,image:product.image,
      description:product.description,available:product.available,
      price:product.price,priceMin:product.priceMin,priceMax:product.priceMax,
      analyticsScore:product.analyticsScore||0,cartAdds30d:product.cartAdds30d||0,orders30d:product.orders30d||0,sortOrder:product.sortOrder,attributes:product.attributes,
      options:product.options.map(option=>({
        variantId:option.variantId,legacyVariantId:option.variantId!==option.productKey?option.productKey:undefined,
        legacyVariantIds:option.legacyVariantIds,
        label:option.label,available:option.available,image:option.image,
        price:option.price,attributes:option.attributes,promotionGroup:promotionGroup(product,option)
      }))
    }))
  };
}
async function refreshCatalogCache(env,cache,cacheKey){
  const payload=applyCatalogDiscounts(publicCatalog(await readCatalog(env)),await getPromotions(env));
  try{
    const since=new Date(Date.now()-30*86400000).toISOString();
    const signals=await all(env,"SELECT product_id,SUM(CASE WHEN event_type='product_view' THEN 1 ELSE 0 END) AS views,SUM(CASE WHEN event_type='add_to_cart' THEN 1 ELSE 0 END) AS cartAdds,SUM(CASE WHEN event_type='order_created' THEN 1 ELSE 0 END) AS orders FROM analytics_events WHERE created_at>=? GROUP BY product_id",[since]);
    const signalMap=new Map(signals.map(row=>[row.product_id,{views:Number(row.views||0),cartAdds:Number(row.cartAdds||0),orders:Number(row.orders||0)}]));
    for(const product of payload.products){
      const signal=signalMap.get(product.id);
      if(!signal)continue;
      product.cartAdds30d=signal.cartAdds;
      product.orders30d=signal.orders;
      product.analyticsScore=signal.views+signal.cartAdds*4+signal.orders*12;
    }
  }catch(error){await logSystem(env,"warning","analytics","Не удалось рассчитать популярность каталога",{});}
  const {updatedAt,...content}=payload;
  const etag='"'+await sha256(JSON.stringify(content))+'"';
  const response=json({...payload,version:VERSION},200,{"Cache-Control":"public, max-age=300","ETag":etag,"X-Catalog-Source":"sheets","X-Catalog-Cached-At":String(Date.now())});
  try{await cache.put(cacheKey,response.clone());}
  catch(error){await logSystem(env,"warning","cache","Не удалось сохранить кеш каталога",{});}
  return response;
}
function catalogClientResponse(request,response,freshSeconds){
  const headers=new Headers(response.headers);
  headers.delete("X-Catalog-Cached-At");
  headers.set("Cache-Control","public, max-age="+freshSeconds+", stale-while-revalidate="+(300-freshSeconds));
  const etag=headers.get("ETag");
  const requested=request.headers.get("If-None-Match")?.split(",").map(tag=>tag.trim().replace(/^W\//,""));
  if(etag&&(requested?.includes(etag)||requested?.includes("*")))return new Response(null,{status:304,headers});
  return new Response(response.body,{status:200,headers});
}
const refreshingCatalogs=new Set();
async function catalogResponse(request,env,ctx){
  const cache=caches.default;
  const config=await getCatalogConfig(env);
  const cacheUrl=new URL("/api/catalog",request.url);
  cacheUrl.searchParams.set("version",VERSION);
  const generation=await first(env,"SELECT updated_by FROM settings WHERE key=?",[BASELINE_KEY]);
  cacheUrl.searchParams.set("generation",generation?.updated_by||"initial");
  cacheUrl.searchParams.set("source",await sha256(JSON.stringify([config.spreadsheetId,config.catalogGid,config.categoriesGid,config.columnMapping,await getPromotions(env)])));
  const cacheKey=new Request(cacheUrl,{method:"GET"});
  const cached=await cache.match(cacheKey);
  const force=new URL(request.url).searchParams.has("refresh");
  if(cached&&!force){
    const age=Date.now()-Number(cached.headers.get("X-Catalog-Cached-At")||0);
    if(age>=config.cacheSeconds*1000&&!refreshingCatalogs.has(cacheKey.url)){
      refreshingCatalogs.add(cacheKey.url);
      ctx.waitUntil(refreshCatalogCache(env,cache,cacheKey)
        .catch(error=>logSystem(env,"warning","catalog","Не удалось обновить кеш каталога",{error:String(error)}))
        .finally(()=>refreshingCatalogs.delete(cacheKey.url)));
    }
    return catalogClientResponse(request,cached,config.cacheSeconds);
  }
  try{
    const response=await refreshCatalogCache(env,cache,cacheKey);
    return catalogClientResponse(request,response,config.cacheSeconds);
  }catch(error){
    if(cached&&!force)return catalogClientResponse(request,cached,config.cacheSeconds);
    return json({error:"Синхронизация каталога временно недоступна",detail:error instanceof Error?error.message:String(error)},502);
  }
}
async function verifyCustomerToken(request,payload=null){
  const token=payload?.customerToken||request.headers.get("X-Customer-Token")||"";
  if(typeof token!=="string"||token.length<24||token.length>256)return "";
  return await sha256(token);
}
async function createOrder(request,env){
  const body=await bodyJson(request);
  if(!body)return json({error:"Некорректный статус оплаты"},400);
  const customerKeyHash=await verifyCustomerToken(request,body);
  if(!customerKeyHash)return json({error:"Не удалось подтвердить сессию покупателя"},400);
  const submittedName=String(body.customerName||"").trim().slice(0,100);
  const method=body.deliveryMethod??"metro";
  if(!["metro","pickup","delivery"].includes(method))return json({error:"Неизвестный способ получения"},400);
  const storageMethod=method==="delivery"?"delivery":"pickup";
  const address=String(body.address||"").trim().slice(0,300);
  const doorbell=method==="delivery"?String(body.doorbell||"").trim().slice(0,80):"";
  const slotDate=String(body.slotDate||"");
  const slotTime=String(body.slotTime||"");
  const comment=String(body.comment||"").trim().slice(0,500);
  const config=await getConfig(env);
  const telegramUser=env.BOT_TOKEN?await verifyTelegramInitData(body.telegramInitData,env.BOT_TOKEN):null;
  const phone="";
  if(!telegramUser)return json({error:"Оформление доступно только внутри Telegram"},401);
  const paymentMethod=body.paymentMethod??"cash";
  if(!["cash","transfer"].includes(paymentMethod))return json({error:"Выберите доступный способ оплаты"},400);
  if((paymentMethod==="cash"&&config.cashPaymentEnabled===false)||
    (paymentMethod==="transfer"&&!(config.transferPaymentEnabled===true&&config.transferDetails))){
    return json({error:"Этот способ оплаты сейчас недоступен. Обновите витрину и выберите другой"},409);
  }
  const transferDetails=paymentMethod==="transfer"?config.transferDetails:"";
  if(method==="delivery"&&!config.deliveryEnabled)return json({error:"Доставка сейчас недоступна"},400);
  if(method==="delivery"&&address.length<5)return json({error:"Укажите адрес доставки"},400);
  if(method==="pickup"&&!config.pickupEnabled)return json({error:"Самовывоз сейчас недоступен"},409);
  if(method==="metro"&&config.metroEnabled===false)return json({error:"Получение у метро сейчас недоступно"},409);
  const dateError=slotDateError(slotDate,method,config);
  if(dateError)return json({error:dateError},400);
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(slotTime))return json({error:"Выберите время получения"},400);
  if(!Array.isArray(body.items)||body.items.length===0||body.items.length>40)return json({error:"Корзина пуста или содержит слишком много позиций"},400);
  const quantities=new Map();
  const maxQuantity=config.maxItemQuantity;
  for(const raw of body.items){
    const quantity=raw?.quantity;
    const key=JSON.stringify([raw?.productId,raw?.variantId]);
    const combined=(quantities.get(key)||0)+quantity;
    if(!Number.isInteger(quantity)||quantity<1||combined>maxQuantity)return json({error:"Некорректное количество"},400);
    quantities.set(key,combined);
  }
  const availableSlots=await getSlots(env,slotDate,method,config);
  if(!availableSlots.some(slot=>slot.time===slotTime))return json({error:"Этот слот уже занят или недоступен. Выберите другое время"},409);

  let catalog;
  try{const catalogConfig=await getCatalogConfig(env);catalog=await loadCatalog({spreadsheetId:catalogConfig.spreadsheetId,catalogGid:catalogConfig.catalogGid,columnMapping:catalogConfig.columnMapping||{}});}
  catch(error){await logSystem(env,"error","orders","Не удалось проверить каталог при оформлении заказа",{});return json({error:"Не удалось проверить наличие товаров. Попробуйте позже"},503);}
  const products=new Map(catalog.products.map(product=>[product.id,product]));
  const items=[],unavailableItems=[],resolvedQuantities=new Map();let total=0;
  for(const raw of body.items){
    const product=products.get(String(raw.productId||""));
    const variantId=String(raw.variantId||"");
    const option=product?.options.find(item=>item.variantId===variantId||item.legacyVariantIds?.includes(variantId))||product?.options.find(item=>item.productKey===variantId);
    if(!option?.available){
      unavailableItems.push({productId:String(raw.productId||""),variantId});
      continue;
    }
    const quantity=raw.quantity;
    const resolvedKey=JSON.stringify([product.id,option.variantId]);
    const combined=(resolvedQuantities.get(resolvedKey)||0)+quantity;
    if(combined>maxQuantity)return json({error:"Некорректное количество"},400);
    resolvedQuantities.set(resolvedKey,combined);
    const lineTotal=option.price*quantity;
    total+=lineTotal;
    items.push({
      productId:product.id,productKey:option.productKey,sku:option.sku,
      productName:product.name,manufacturer:product.manufacturer,category:product.category,
      optionLabel:option.label,attributes:option.attributes,quantity,promotionGroup:promotionGroup(product,option),
      unitPrice:option.price,lineTotal
    });
  }
  if(unavailableItems.length)return json({error:"Некоторые позиции больше недоступны",unavailableItems},409);
  const promotions=await getPromotions(env);
  for(const item of items){
    const rule=discountForProduct(promotions,{id:item.productId,name:item.productName,category:item.category},{variantId:item.variantId,productKey:item.productKey,sku:item.sku});
    if(!rule)continue;
    item.attributes={...item.attributes,discount:{id:rule.id,title:rule.title,percent:rule.discountPercent,originalPrice:item.unitPrice}};
    item.unitPrice=Math.max(0,Math.round(item.unitPrice*(100-rule.discountPercent)/100));
    item.lineTotal=item.unitPrice*item.quantity;
  }
  total=items.reduce((sum,item)=>sum+item.lineTotal,0);
  const itemSubtotal=total;
  if(itemSubtotal<Math.max(0,Number(config.minOrder)||0))return json({error:"Минимальная сумма заказа — "+(Number(config.minOrder)/100).toFixed(2).replace(".",",")+" BYN"},400);
  const promoResult=await promocodeDiscount(env,body.promoCode,itemSubtotal);
  if(promoResult.error)return json({error:promoResult.error},400);
  const promoDiscount=Number(promoResult.discount||0);
  const deliveryFee=method==="delivery"?Math.max(0,Number(config.deliveryFee)||0):0;
  total=itemSubtotal-promoDiscount+deliveryFee;
  const rule=highestPromotion(promotions,items);
  const gifts=rule?promotionGiftOptions(catalog.products,rule):[];
  const gift=gifts.length?gifts[Math.floor(Math.random()*gifts.length)]:null;
  const orderItems=gift?[...items,{
    productId:gift.product.id,productKey:gift.option.productKey,sku:gift.option.sku,
    productName:gift.product.name,manufacturer:gift.product.manufacturer,category:gift.product.category,
    optionLabel:"Подарок по акции "+rule.title+" · "+gift.option.label,
    attributes:{...gift.option.attributes,promotion:rule.id},quantity:1,unitPrice:0,lineTotal:0
  }]:items;

  const telegramUserId=telegramUser?String(telegramUser.id):null;
  const telegramUsername=String(telegramUser?.username||"").replace(/^@/,"").slice(0,80);
  const verifiedName=[telegramUser?.first_name,telegramUser?.last_name].filter(Boolean).join(" ").trim();
  const name=(verifiedName||telegramUsername||"Telegram").slice(0,100);
  const recoveryCode=null;
  const recoveryHash=null;
  const orderId=randomId(),createdAt=now();
  const numberResult=await run(env,"INSERT INTO order_numbers(created_at) VALUES(?)",[createdAt]);
  const orderNumber=Number(numberResult.meta?.last_row_id||Date.now());
  const capacity=Number(config.slotCapacity)||4;
  const statements=[
    env.DB.prepare("INSERT INTO orders(id,number,customer_key_hash,telegram_user_id,telegram_username,customer_name,phone,delivery_method,address,fulfillment_method,doorbell,slot_date,slot_time,comment,status,total,delivery_fee,currency,payment_method,payment_status,transfer_details,recovery_hash,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM orders WHERE slot_date=? AND slot_time=? AND COALESCE(fulfillment_method,delivery_method)=? AND status NOT IN ('cancelled','rejected')) < ?")
      .bind(orderId,String(orderNumber),customerKeyHash,telegramUserId,telegramUsername||null,name,phone,storageMethod,address,method,doorbell,slotDate,slotTime,comment,String(total),String(deliveryFee),config.currency||"BYN",paymentMethod,"unpaid",transferDetails,recoveryHash,createdAt,createdAt,slotDate,slotTime,method,String(capacity)),
    ...orderItems.map(item=>env.DB.prepare("INSERT INTO order_items(order_id,product_id,product_key,sku,product_name,manufacturer,option_label,attributes_json,quantity,unit_price,line_total) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)")
      .bind(orderId,item.productId,item.productKey,item.sku,item.productName,item.manufacturer,item.optionLabel,JSON.stringify(item.attributes),String(item.quantity),String(item.unitPrice),String(item.lineTotal),orderId)),
    env.DB.prepare("INSERT INTO order_events(order_id,actor_role,event_type,to_status,message,metadata_json,created_at) SELECT ?,'customer','created','new','Заказ оформлен',?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)")
      .bind(orderId,JSON.stringify({deliveryMethod:method,slotDate,slotTime,doorbell,promotion:gift?{id:rule.id,title:rule.title,giftProductId:gift.product.id,giftVariantId:gift.option.variantId}:null,promocode:promoResult.promo?{code:promoResult.promo.code,title:promoResult.promo.title,discount:promoDiscount}:null}),createdAt,orderId),
    ...(promoResult.promo?[env.DB.prepare("INSERT INTO order_events(order_id,actor_role,event_type,message,metadata_json,created_at) SELECT ?,'customer','promo_code_applied','Promo code applied',?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)")
      .bind(orderId,JSON.stringify({code:promoResult.promo.code,title:promoResult.promo.title,discount:promoDiscount}),createdAt,orderId)]:[]),
    ...items.map(item=>env.DB.prepare("INSERT INTO analytics_events(event_type,product_id,product_name,category,brand,visitor_hash,created_at) SELECT 'order_created',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)")
      .bind(item.productId,item.productName,item.category,item.manufacturer,customerKeyHash,createdAt,orderId))
  ];
  let result;
  try{result=await env.DB.batch(statements);}
  catch(error){
    await logSystem(env,"error","orders","Ошибка создания заказа",{});
    return json({error:"Не удалось сохранить заказ. Попробуйте ещё раз"},500);
  }
  if(!result?.[0]?.meta?.changes)return json({error:"Слот только что заняли. Выберите другое время"},409);
  const order=await loadOrder(env,orderId);
  await notifyOrder(env,order,"new");
  return json({success:true,order:customerOrder(order),orderNumber,...(recoveryCode?{recoveryCode}:{})});
}
async function recoverOrder(request,env){
  const body=await bodyJson(request);
  const customerHash=await verifyCustomerToken(request,body);
  if(!customerHash)return json({error:"Сессия покупателя не найдена"},400);
  const code=String(body?.code||"").trim().toLowerCase();
  if(!/^[a-f0-9]{24}$/.test(code))return json({error:"Проверьте код из подтверждения заказа"},400);
  const order=await first(env,"SELECT id,customer_key_hash FROM orders WHERE recovery_hash=? AND COALESCE(telegram_user_id,'')=''",[await sha256(code)]);
  if(!order)return json({error:"Заказ с таким номером не найден"},404);
  if(order.customer_key_hash!==customerHash){
    await run(env,"INSERT OR IGNORE INTO order_recovery_sessions(order_id,customer_key_hash,created_at) VALUES(?,?,?)",[order.id,customerHash,now()]);
  }
  return json({success:true});
}
async function updateOrderStatus(env,orderId,status,actor,message="",courierId=null){
  const order=await loadOrder(env,orderId);
  if(!order)return {error:"Заказ не найден",status:404};
  const allowed={
    new:["confirmed","rejected","cancelled"],
    confirmed:["preparing","cancelled"],
    preparing:["ready","cancelled"],
    ready:["assigned","completed","cancelled"],
    assigned:["picked_up","ready","cancelled"],
    picked_up:["on_the_way","delivered"],
    on_the_way:["delivered"],
    delivered:["completed"],
    completed:[],cancelled:[],rejected:[]
  };
  if(status===order.status&&status==="assigned"&&courierId){
    const updatedAt=now();
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET courier_id=?,manager_id=?,updated_at=?,version=version+1 WHERE id=?").bind(courierId,actor.id||null,updatedAt,orderId),
      env.DB.prepare("INSERT INTO order_events(order_id,actor_id,actor_role,event_type,from_status,to_status,message,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(orderId,actor.id||null,actor.role||"system","courier_reassigned",order.status,order.status,"Курьер переназначен",updatedAt)
    ]);
    const updated=await loadOrder(env,orderId);
    await notifyOrder(env,updated,"assigned");
    return {order:updated};
  }
  if(!allowed[order.status]?.includes(status))return {error:"Недопустимый переход статуса",status:409};
  if(status==="assigned"&&(!courierId||order.delivery_method!=="delivery"))return {error:"Для доставки назначьте курьера",status:400};
  const updatedAt=now();
  const nextCourier=courierId||order.courier_id||null;
  await env.DB.batch([
    env.DB.prepare("UPDATE orders SET status=?,courier_id=?,manager_id=?,updated_at=?,version=version+1 WHERE id=?")
      .bind(status,nextCourier,actor.id||null,updatedAt,orderId),
    env.DB.prepare("INSERT INTO order_events(order_id,actor_id,actor_role,event_type,from_status,to_status,message,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind(orderId,actor.id||null,actor.role||"system","status_changed",order.status,status,String(message||statusMessage(status)).slice(0,500),updatedAt)
  ]);
  const updated=await loadOrder(env,orderId);
  await notifyOrder(env,updated,status);
  return {order:updated};
}
async function dashboard(env){
  const counts=await all(env,"SELECT status,COUNT(*) AS count FROM orders GROUP BY status");
  const revenue=await first(env,"SELECT COALESCE(SUM(total),0) AS total,COUNT(*) AS count FROM orders WHERE status IN ('completed','delivered')");
  const today=timeParts(new Date(),(await getConfig(env)).timezone);
  const todayKey=today.year+"-"+today.month+"-"+today.day;
  const todayOrders=await first(env,"SELECT COUNT(*) AS count FROM orders WHERE substr(created_at,1,10)=?",[todayKey]);
  const latest=await all(env,"SELECT id,number,customer_name,delivery_method,slot_date,slot_time,status,total,created_at FROM orders ORDER BY created_at DESC LIMIT 8");
  const sync=await first(env,"SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 1");
  const errors=await first(env,"SELECT COUNT(*) AS count FROM system_logs WHERE level IN ('error','critical') AND created_at>=?",[new Date(Date.now()-86400000).toISOString()]);
  return {counts:Object.fromEntries(counts.map(row=>[row.status,Number(row.count)])),revenue:Number(revenue?.total||0),completedOrders:Number(revenue?.count||0),todayOrders:Number(todayOrders?.count||0),latest,sync,errors24h:Number(errors?.count||0)};
}
async function staffLogin(request,env){
  if(!await reserveLoginAttempt(env,request))return loginRateLimited();
  const body=await bodyJson(request);
  if(!body||typeof body.code!=="string")return json({error:"Введите код доступа"},400);
  const code=body.code.trim();
  if(code.length<12||code.length>128)return json({error:"Введите код доступа"},400);
  const codeHash=await sha256(code);
  const bootstrapUsed=await getSetting(env,"bootstrap_used",false);
  const storedBootstrapHash=await getSetting(env,"bootstrap_hash","");
  const bootstrapHash=storedBootstrapHash||(env.BOOTSTRAP_CODE?await sha256(env.BOOTSTRAP_CODE):"");
  let staffId=randomId(),role="manager",displayName=String(body.displayName||"").trim().slice(0,80),telegramId="",permissions=[],inviteId=null;
  if(!bootstrapUsed&&bootstrapHash&&safeEqual(codeHash,bootstrapHash)){
    if(displayName.length<2)return json({error:"Укажите имя владельца"},400);
    role="owner";permissions=PERMISSION_KEYS;
    // Consumption happens atomically with account and session creation.
  }else{
    const invite=await first(env,"SELECT * FROM staff_invites WHERE code_hash=? AND active=1 AND used_at IS NULL AND expires_at>?",[codeHash,now()]);
    if(!invite)return json({error:"Код недействителен или уже использован"},401);
    if(!["manager","courier"].includes(invite.role))return json({error:"Код недействителен или уже использован"},401);
    inviteId=invite.id;role=invite.role;displayName=invite.display_name;telegramId=invite.telegram_id||"";
    try{permissions=JSON.parse(invite.permissions_json||"[]");}catch{permissions=[];}
  }
  permissions=normalizePermissions(permissions,role);
  if(role==="manager"&&!permissions.length)return json({error:"Код недействителен или уже использован"},401);
  try{
    const token=await redeemStaffCredential(env,{staffId,displayName,role,telegramId,permissions,inviteId,codeHash});
    if(!token)return json({error:"Код недействителен или уже использован"},401);
    await logSystem(env,"info","auth","Вход сотрудника",{staffId,role,permissions});
    return json({success:true,staff:{id:staffId,name:displayName,role,permissions}},200,{"Set-Cookie":cookieHeader(token)});
  }catch(error){
    await logSystem(env,"error","auth","Не удалось создать учётную запись сотрудника",{});
    return json({error:"Не удалось выполнить вход"},500);
  }
}
async function demoStaffLogin(request,env){
  if(!env.DEMO_ADMIN_USERNAME||!env.DEMO_ADMIN_PASSWORD)return json({error:"Демо-вход отключён"},404);
  if(!await reserveLoginAttempt(env,request))return loginRateLimited();
  const body=await bodyJson(request);
  if(typeof body?.username!=="string"||typeof body?.password!=="string"||
    body.username.length>80||body.password.length>256)return json({error:"Неверный логин или пароль"},401);
  if(!safeEqual(body.username,env.DEMO_ADMIN_USERNAME)||!safeEqual(body.password,env.DEMO_ADMIN_PASSWORD))
    return json({error:"Неверный логин или пароль"},401);
  if(body?.mode==="courier"){
    const id="demo-courier",name="Демо-курьер";
    await run(env,"INSERT OR IGNORE INTO staff(id,display_name,role,active,created_at) VALUES(?,?,'courier',1,?)",[id,name,now()]);
    const staff=await first(env,"SELECT id,display_name FROM staff WHERE id=? AND role='courier' AND active=1",[id]);
    if(!staff)return json({error:"Демо-курьер отключён"},403);
    const token=await createSession(env,staff.id);
    await logSystem(env,"info","auth","Вход демо-курьера",{staffId:staff.id});
    return json({success:true,staff:{id:staff.id,name:staff.display_name,role:"courier",permissions:[]}},200,{"Set-Cookie":cookieHeader(token)});
  }
  const owner=await resolveDemoOwner(env);
  if(!owner)return json({error:"Демо-администратор отключён"},403);
  const token=await createSession(env,owner.id);
  await logSystem(env,"info","auth","Вход демо-администратора",{staffId:owner.id});
  return json({success:true,staff:{id:owner.id,name:owner.display_name,role:"owner",permissions:PERMISSION_KEYS}},200,{"Set-Cookie":cookieHeader(token)});
}
// Categories are read solely from the Categories tab. D1 is not a category database.
async function sourceCategories(env){
  const config=await getCatalogConfig(env);
  const gid=String(config.categoriesGid||env.GOOGLE_CATEGORIES_GID||"");
  if(!config.spreadsheetId||!/^\d+$/.test(gid))throw new Error("Подключите вкладку «Категории» Google Sheets");
  const url="https://docs.google.com/spreadsheets/d/"+encodeURIComponent(config.spreadsheetId)+"/export?format=csv&gid="+gid;
  const response=await fetch(url,{headers:{Accept:"text/csv"},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error("Не удалось прочитать вкладку «Категории»: HTTP "+response.status);
  const rows=parseCSV(await response.text());
  const header=(rows.shift()||[]).map(v=>String(v).trim().toLowerCase());
  const col=key=>header.indexOf(key);
  if(col("id")<0||col("name")<0||col("image_url")<0)throw new Error("Вкладка «Категории»: нужны колонки id, name, image_url");
  const result=[];
  const seen=new Set(),productKeys=new Set();
  for(const [index,row] of rows.entries()){
    const id=String(row[col("id")]||"").trim();
    const name=String(row[col("name")]||"").trim();
    const key=String(row[col("product_category")]||name).trim();
    if(!id&&!name&&!key)continue;
    if(!id||!name||!key||id===name||seen.has(id)||productKeys.has(key))
      throw new Error("Категории: некорректный или повторяющийся ID / категория в строке "+(index+2));
    seen.add(id);productKeys.add(key);
    const rawImage=String(row[col("image_url")]||"").trim();
    const image=/^https:\/\//i.test(rawImage)?rawImage:"";
    const rawActive=col("active")>=0?String(row[col("active")]||"").toLowerCase():"true";
    const active=!["false","0","нет","no"].includes(rawActive);
    const rawSort=col("sort_order")>=0?Number(row[col("sort_order")]):index;
    result.push({key,id,label:name,name,image,imageUrl:image,active,sortOrder:Number.isFinite(rawSort)?rawSort:index,sourceCategory:key,sourceLabel:name,sourceImage:image});
  }
  return result;
}
async function categorySettings(env){
  const categories=await sourceCategories(env);
  return Object.fromEntries(categories.map(c=>[c.key,c]));
}
async function getPromotions(env){
  const defaults=env.DEMO_ADMIN_USERNAME&&env.DEMO_ADMIN_PASSWORD?DEMO_PROMOTIONS:[];
  return getSetting(env,"promotions",defaults);
}
async function publicSettings(env){
  const c=await getConfig(env);
  return {
    ...storefrontAppearance(c),currency:c.currency,metroEnabled:c.metroEnabled!==false,pickupEnabled:c.pickupEnabled,
    deliveryEnabled:c.deliveryEnabled,deliveryFee:c.deliveryFee,minOrder:c.minOrder,
    ageGateEnabled:c.ageGateEnabled!==false,cashPaymentEnabled:c.cashPaymentEnabled!==false,
    transferPaymentEnabled:c.transferPaymentEnabled===true&&!!c.transferDetails,
    address:c.address,phone:c.phone,daysAhead:c.daysAhead,maxItemQuantity:c.maxItemQuantity,metroMeetingHint:c.metroMeetingHint,
    categories:await categorySettings(env),promotions:(await getPromotions(env)).filter(rule=>rule.active),
    telegramCheckoutEnabled:!!env.BOT_TOKEN
  };
}
async function recordAnalyticsEvent(request,env){
  const config=await getConfig(env);
  if(config.analyticsEnabled===false)return json({success:true});
  const body=await bodyJson(request);
  if(!body)return json({error:"Некорректное событие"},400);
  const allowed=new Set(["product_view","add_to_cart","variant_unavailable_click","search","category_filter","brand_filter","checkout_start","order_created"]);
  const eventType=String(body.eventType||"");
  if(!allowed.has(eventType))return json({error:"Неизвестный тип события"},400);
  const token=String(body.visitorToken||"").slice(0,200);
  const visitorHash=token.length>=16?await sha256(token):null;
  // Never persist free-form search text: it may contain personal information.
  const query=null;
  await run(env,"INSERT INTO analytics_events(event_type,product_id,product_name,category,brand,query_text,visitor_hash,created_at) VALUES(?,?,?,?,?,?,?,?)",[
    eventType,String(body.productId||"").slice(0,500)||null,
    String(body.productName||"").slice(0,180)||null,
    String(body.category||"").slice(0,100)||null,
    String(body.brand||"").slice(0,100)||null,
    query||null,visitorHash,now()
  ]);
  return json({success:true});
}
async function adminAnalytics(env,days){
  const since=new Date(Date.now()-days*86400000).toISOString();
  const [events,topProducts,searches,daily,visitors]=await Promise.all([
    all(env,"SELECT event_type,COUNT(*) AS count FROM analytics_events WHERE created_at>=? GROUP BY event_type",[since]),
    all(env,"SELECT product_id,MAX(product_name) AS name,MAX(category) AS category,MAX(brand) AS brand,SUM(CASE WHEN event_type='product_view' THEN 1 ELSE 0 END) AS views,SUM(CASE WHEN event_type='add_to_cart' THEN 1 ELSE 0 END) AS cart_adds,SUM(CASE WHEN event_type='order_created' THEN 1 ELSE 0 END) AS orders FROM analytics_events WHERE created_at>=? AND product_id IS NOT NULL GROUP BY product_id ORDER BY (SUM(CASE WHEN event_type='product_view' THEN 1 ELSE 0 END)+SUM(CASE WHEN event_type='add_to_cart' THEN 1 ELSE 0 END)*4+SUM(CASE WHEN event_type='order_created' THEN 1 ELSE 0 END)*12) DESC LIMIT 12",[since]),
    all(env,"SELECT query_text,COUNT(*) AS count FROM analytics_events WHERE created_at>=? AND event_type='search' AND query_text IS NOT NULL GROUP BY query_text ORDER BY count DESC LIMIT 12",[since]),
    all(env,"SELECT substr(created_at,1,10) AS day,COUNT(*) AS events,SUM(CASE WHEN event_type='product_view' THEN 1 ELSE 0 END) AS views,SUM(CASE WHEN event_type='add_to_cart' THEN 1 ELSE 0 END) AS cart_adds,SUM(CASE WHEN event_type='order_created' THEN 1 ELSE 0 END) AS orders FROM analytics_events WHERE created_at>=? GROUP BY substr(created_at,1,10) ORDER BY day",[since]),
    first(env,"SELECT COUNT(DISTINCT visitor_hash) AS count FROM analytics_events WHERE created_at>=? AND visitor_hash IS NOT NULL",[since])
  ]);
  const counts=Object.fromEntries(events.map(row=>[row.event_type,Number(row.count||0)]));
  return {days,totals:{views:counts.product_view||0,cartAdds:counts.add_to_cart||0,orders:counts.order_created||0,searches:counts.search||0,checkouts:counts.checkout_start||0,uniqueVisitors:Number(visitors?.count||0)},events:counts,topProducts:topProducts.map(row=>({...row,score:Number(row.views||0)+Number(row.cart_adds||0)*4+Number(row.orders||0)*12})),searches,daily};
}
async function telegramWebhook(request,env){
  if(!env.BOT_TOKEN)return json({ok:true});
  const secret=await getSetting(env,"telegram_webhook_secret","");
  if(!secret||!safeEqual(request.headers.get("X-Telegram-Bot-Api-Secret-Token")||"",secret))return json({error:"Forbidden"},403);
  const update=await bodyJson(request);
  if(!update)return json({ok:true});
  if(update.update_id){
    const inserted=await run(env,"INSERT OR IGNORE INTO telegram_updates(update_id,received_at,handled) VALUES(?,?,0)",[String(update.update_id),now()]);
    if(Number(inserted.meta?.changes||0)===0)return json({ok:true,duplicate:true});
  }
  const callback=update.callback_query;
  if(callback?.data){
    const [kind,orderId,action]=String(callback.data).split("|");
    const telegramId=String(callback.from?.id||"");
    const staffRow=await first(env,"SELECT id,role,permissions_json FROM staff WHERE telegram_id=? AND active=1",[telegramId]);
    const staff=staffRow?{...staffRow,permissions:permissionsFromStorage(staffRow.permissions_json,staffRow.role)}:null;
    if(kind==="order"&&staff&&hasPermission(staff,"orders.manage")){
      const result=await updateOrderStatus(env,orderId,action,{id:staff.id,role:staff.role},"Изменено из Telegram");
      try{await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id,text:result.error||"Статус обновлён"});}
      catch(error){await logSystem(env,"warning","telegram","Не удалось подтвердить callback Telegram",{});}
    }else{
      await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"Нет доступа к этому действию",show_alert:true});
    }
  }
  const message=update.message;
  if(message?.chat?.id&&typeof message.text==="string"){
    const command=message.text.trim().split(/\s+/)[0].toLowerCase().replace(/@[^\s]+$/,"");
    if(["/start","/shop","/catalog","/orders","/help"].includes(command)){
      const appUrl=new URL("/",request.url).toString();
      const copy=command==="/orders"?"История заказов открывается в приложении.":"Откройте магазин, выберите товары и оформите заказ в Telegram.";
      await sendTelegram(env,message.chat.id,"<b>VIOLET SHOP</b>\n"+copy,{inline_keyboard:[[{text:"Открыть магазин",web_app:{url:appUrl}}]]});
    }
  }
  if(update.update_id)await run(env,"UPDATE telegram_updates SET handled=1 WHERE update_id=?",[String(update.update_id)]);
  return json({ok:true});
}

function publicInfoPage(path){
  const privacy=path==="/privacy";
  const title=privacy?"Конфиденциальность":"Правила магазина";
  const copy=privacy?
    "<p>Демонстрационное приложение обрабатывает идентификатор и имя подтверждённой учётной записи Telegram, данные, предоставленные пользователем, и технические сведения о сеансе. В браузере могут сохраняться настройки, корзина и технический ключ исторической сессии. При включённой аналитике сохраняются псевдонимные события; свободный текст поиска больше не записывается. Это описание демо, а не окончательная политика обработки персональных данных коммерческого оператора.</p><p>Вопросы о данных можно задать менеджеру по контактам, указанным при оформлении заказа.</p>":
    "<p>Каталог предназначен для совершеннолетних покупателей. При оформлении выберите доступные способы получения и оплаты. Наличие и время получения подтверждает менеджер.</p><p>Новый заказ можно отменить в разделе «Мои заказы». Сохраните номер заказа, если вам нужно связаться с менеджером.</p>";
  return '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' — VIOLET SHOP</title><style>html{font:1rem/1.55 system-ui,sans-serif;color-scheme:dark;background:#101112;color:#e8ecef}main{max-width:42rem;margin:auto;padding:1.4rem}a{color:#e8ecef}</style><main><a href="/">Вернуться в магазин</a><h1>'+title+'</h1>'+copy+'</main></html>';
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const path=url.pathname;
    if(path==="/favicon.ico"&&["GET","HEAD"].includes(request.method)){
      return new Response(null,{status:204,headers:{"Cache-Control":"public, max-age=86400"}});
    }
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Allow":"GET,POST,PUT,PATCH,DELETE,OPTIONS"}});
    if(["POST","PUT","PATCH","DELETE"].includes(request.method)&&!validOrigin(request))return json({error:"Origin not allowed"},403);

    try{
      if(path==="/api/health"&&request.method==="GET"){
        return json({ok:true,service:"violet-shop",version:VERSION});
      }
      if(path==="/api/catalog"&&request.method==="GET")return await catalogResponse(request,env,ctx);
      if(path==="/api/settings/public"&&request.method==="GET")return json(await publicSettings(env));
      if(path==="/api/promocodes/validate"&&request.method==="POST"){
        const body=await bodyJson(request);
        const subtotal=Math.max(0,Math.round(Number(body?.subtotal)||0));
        const result=await promocodeDiscount(env,body?.code,subtotal);
        return result.error?json({error:result.error},400):json({valid:!!result.promo,promo:result.promo?{code:result.promo.code,title:result.promo.title,type:result.promo.type,value:result.promo.value}:null,discount:result.discount||0});
      }
      if(path==="/api/analytics/event"&&request.method==="POST")return await recordAnalyticsEvent(request,env);
      if(path==="/api/slots"&&request.method==="GET"){
        const date=url.searchParams.get("date")||"";
        const method=url.searchParams.get("method")||"pickup";
        const config=await getConfig(env);
        const error=slotDateError(date,method,config);
        if(error)return json({error},400);
        const slots=await getSlots(env,date,method,config);
        if(slots.length||url.searchParams.get("nearest")!=="1")return json({date,method,slots});
        for(let offset=1;offset<=config.daysAhead;offset++){
          const nextDate=nextCalendarDate(date,offset);
          if(slotDateError(nextDate,method,config))break;
          const nextSlots=await getSlots(env,nextDate,method,config);
          if(nextSlots.length)return json({date,method,slots,nextDate,nextSlots});
        }
        return json({date,method,slots});
      }
      if(path==="/api/orders"&&request.method==="POST")return await createOrder(request,env);
      if(path==="/api/orders/recover"&&request.method==="POST")return await recoverOrder(request,env);
      const customerCancelMatch=path.match(/^\/api\/orders\/([^/]+)\/cancel$/);
      if(customerCancelMatch&&request.method==="POST"){
        const body=await bodyJson(request);
        const hash=await verifyCustomerToken(request,body);
        const initData=body?.telegramInitData||request.headers.get("X-Telegram-Init-Data")||"";
        const telegramUser=await verifyTelegramInitData(initData,env.BOT_TOKEN);
        const scope=customerOrderScope(telegramUser,hash,!!initData);
        if(!scope)return json({error:"Сессия недействительна. Откройте приложение заново в Telegram."},401);
        const order=await loadOrder(env,customerCancelMatch[1]);
        if(!order)return json({error:"Заказ не найден"},404);
        const sessionMatch=!order.telegram_user_id&&scope.customerHash&&(order.customer_key_hash===scope.customerHash||await first(env,"SELECT 1 FROM order_recovery_sessions WHERE order_id=? AND customer_key_hash=?",[order.id,scope.customerHash]));
        if(!(scope.telegramId&&order.telegram_user_id===scope.telegramId)&&!sessionMatch)return json({error:"Заказ не найден"},404);
        if(order.status!=="new")return json({error:"Отменить можно только новый заказ. Свяжитесь с магазином"},409);
        const result=await updateOrderStatus(env,order.id,"cancelled",{id:null,role:"customer"},"Отменён покупателем");
        return result.error?json({error:result.error},result.status):json({success:true,order:customerOrder(result.order)});
      }
      if(path==="/api/orders"&&request.method==="GET"){
        const hash=await verifyCustomerToken(request);
        const initData=request.headers.get("X-Telegram-Init-Data")||"";
        const telegramUser=await verifyTelegramInitData(initData,env.BOT_TOKEN);
        const scope=customerOrderScope(telegramUser,hash,!!initData);
        if(!scope)return json({error:"Сессия недействительна. Откройте приложение заново в Telegram."},401);
        const orders=scope.telegramId
          ?await all(env,"SELECT id FROM orders WHERE telegram_user_id=? ORDER BY created_at DESC LIMIT 50",[scope.telegramId])
          :await all(env,"SELECT id FROM orders WHERE COALESCE(telegram_user_id,'')='' AND (customer_key_hash=? OR id IN (SELECT order_id FROM order_recovery_sessions WHERE customer_key_hash=?)) ORDER BY created_at DESC LIMIT 50",[scope.customerHash,scope.customerHash]);
        const detailed=await Promise.all(orders.map(row=>loadOrder(env,row.id)));
        return json({orders:detailed.filter(Boolean).map(customerOrder)});
      }
      if(path==="/api/staff/login-options"&&request.method==="GET")return json({demoLoginEnabled:!!(env.DEMO_ADMIN_USERNAME&&env.DEMO_ADMIN_PASSWORD)});
      if(path==="/api/staff/demo-login"&&request.method==="POST")return await demoStaffLogin(request,env);
      if(path==="/api/staff/login"&&request.method==="POST")return await staffLogin(request,env);
      if(path==="/api/staff/session"&&request.method==="GET"){
        const staff=await getStaff(request,env);
        return staff?json({authenticated:true,staff}):json({authenticated:false},401);
      }
      if(path==="/api/staff/logout"&&request.method==="POST"){
        const token=parseCookie(request,COOKIE);
        if(token)await run(env,"DELETE FROM sessions WHERE id_hash=?",[await sha256(token)]);
        return json({success:true},200,{"Set-Cookie":clearCookie()});
      }
      if(path==="/api/telegram/webhook"&&request.method==="POST")return await telegramWebhook(request,env);

      const staff=await getStaff(request,env);
      const courierOk=staff?.role==="courier";

      if(path==="/api/courier/orders"&&request.method==="GET"){
        if(!courierOk)return unauthorized();
        const rows=await all(env,"SELECT id FROM orders WHERE courier_id=? AND status IN ('assigned','picked_up','on_the_way') ORDER BY slot_date,slot_time",[staff.id]);
        const orders=await Promise.all(rows.map(row=>loadOrder(env,row.id)));
        return json({orders:orders.filter(Boolean).map(adminOrder)});
      }
      const courierOrderMatch=path.match(/^\/api\/courier\/orders\/([^/]+)$/);
      if(courierOrderMatch&&request.method==="PATCH"){
        if(!courierOk)return unauthorized();
        const order=await loadOrder(env,courierOrderMatch[1]);
        if(!order||order.courier_id!==staff.id)return json({error:"Этот заказ не назначен вам"},403);
        const body=await bodyJson(request);
        const result=await updateOrderStatus(env,order.id,String(body?.status||""),staff,String(body?.message||""));
        return result.error?json({error:result.error},result.status):json({success:true,order:adminOrder(result.order)});
      }

      if(path.startsWith("/api/admin/")){
        if(!isManager(staff))return unauthorized();
        const requiredPermission=permissionForAdminRoute(path,request.method);
        if(!requiredPermission)return json({error:"Маршрут не найден"},404);
        if(!hasPermission(staff,requiredPermission))return json({error:"Недостаточно прав для этого действия"},403);
        if(path==="/api/admin/appearance"&&request.method==="GET"){
          return json({appearance:sanitizeAdminAppearance(await getSetting(env,"admin_appearance",DEFAULT_ADMIN_APPEARANCE))});
        }
        if(path==="/api/admin/promotions"&&request.method==="GET")return json({promotions:await getPromotions(env)});
        if(path==="/api/admin/promotions"&&request.method==="PUT"){
          const body=await bodyJson(request);
          const saved=await first(env,"SELECT value_json FROM settings WHERE key='promotions'");
          const current=saved?JSON.parse(saved.value_json):await getPromotions(env);
          if(JSON.stringify(body?.previous)!==JSON.stringify(current))return json({error:"Список акций изменился. Обновите страницу и повторите."},409);
          if(!Array.isArray(body?.promotions)||body.promotions.length>20)return json({error:"Можно сохранить до 20 акций"},400);
          const currentIds=new Set(current.map(rule=>rule.id));
          const promotions=body.promotions.map(input=>normalizePromotion(input,currentIds.has(input?.id)?input.id:randomId()));
          if(promotions.some(rule=>!rule)||new Set(promotions.map(rule=>rule.id)).size!==promotions.length)return json({error:"Заполните название, описание, подарок, количество и типы товаров для каждой акции"},400);
          const values=[JSON.stringify(promotions),now(),staff.id];
          const result=saved
            ?await run(env,"UPDATE settings SET value_json=?,updated_at=?,updated_by=? WHERE key='promotions' AND value_json=?",[...values,saved.value_json])
            :await run(env,"INSERT OR IGNORE INTO settings(key,value_json,updated_at,updated_by) VALUES('promotions',?,?,?)",values);
          if(!result.meta?.changes)return json({error:"Список акций изменился. Обновите страницу и повторите."},409);
          return json({promotions});
        }
        if(path==="/api/admin/promocodes"&&request.method==="GET")return json({promocodes:await getPromocodes(env)});
        if(path==="/api/admin/promocodes"&&request.method==="PUT"){
          const body=await bodyJson(request);
          if(!Array.isArray(body?.promocodes)||body.promocodes.length>50)return json({error:"Too many promo codes"},400);
          const codes=body.promocodes.map(item=>normalizePromocode(item,item?.id||randomId()));
          if(codes.some(item=>!item)||new Set(codes.map(item=>item.code)).size!==codes.length)return json({error:"Check promo code fields and uniqueness"},400);
          await setSetting(env,"promocodes",codes,staff.id);
          await logSystem(env,"info","promocodes","Promo codes updated",{count:codes.length,staffId:staff.id});
          return json({promocodes:codes});
        }
        if(path==="/api/admin/analytics"&&request.method==="GET"){
          const days=Math.max(7,Math.min(90,Number(url.searchParams.get("days"))||30));
          return json(await adminAnalytics(env,days));
        }
        if(path==="/api/admin/appearance"&&request.method==="PUT"){
          const body=await bodyJson(request);
          if(!body||typeof body!=="object")return json({error:"Некорректные настройки интерфейса"},400);
          const appearance=sanitizeAdminAppearance(body.appearance||{});
          await setSetting(env,"admin_appearance",appearance,staff.id);
          await logSystem(env,"info","appearance","Обновлён внешний вид панели управления",{staffId:staff.id});
          return json({success:true,appearance});
        }
        if(path==="/api/admin/categories"&&request.method==="GET"){
          return json({categories:Object.values(await categorySettings(env))});
        }
        if(path==="/api/admin/categories"&&request.method==="PUT"){
          return json({error:"Изменения категорий вносятся во вкладке «Категории» Google Sheets. Изолированное сохранение в D1 отключено."},409);
        }
        if(path==="/api/admin/catalog-preview"&&request.method==="GET"){
          const config=await getCatalogConfig(env);
          if(!config.spreadsheetId||!config.catalogGid)return json({error:"Сначала подключите Google Sheets"},400);
          const url="https://docs.google.com/spreadsheets/d/"+encodeURIComponent(config.spreadsheetId)+"/export?format=csv&gid="+encodeURIComponent(config.catalogGid);
          const response=await fetch(url,{headers:{Accept:"text/csv,text/plain;q=0.9,*/*;q=0.1"},signal:AbortSignal.timeout(12000)});
          if(!response.ok)return json({error:"Google Sheets вернул HTTP "+response.status},502);
          const rows=parseCSV(await response.text());
          if(!rows.length)return json({error:"Таблица пустая"},400);
          return json({headers:rows[0].map(value=>String(value||"").trim()),sample:rows[1]||[],rowCount:Math.max(0,rows.length-1)});
        }
        if(path==="/api/admin/catalog-template"&&request.method==="GET"){
          const template=await getSetting(env,"catalog_template",{name:"",headers:[],columnMapping:{}});
          return json({name:template.name||"",headers:template.headers||[],columnMapping:template.columnMapping||{},updatedAt:template.updatedAt||null,hasContent:!!template.content});
        }
        if(path==="/api/admin/catalog-template/file"&&request.method==="GET"){
          const template=await getSetting(env,"catalog_template",{});
          if(!template.content)return json({error:"Файл шаблона ещё не прикреплён"},404);
          return new Response(template.content,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(template.name||"catalog-template.csv"),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
        }
        if(path==="/api/admin/catalog-template"&&request.method==="PUT"){
          const body=await bodyJson(request);
          if(!Array.isArray(body?.headers)||body.headers.length>100)return json({error:"Шаблон должен содержать не более 100 столбцов"},400);
          const headers=body.headers.map(value=>String(value||"").trim().slice(0,100)).filter(Boolean);
          const columnMapping={};
          for(const [field,source] of Object.entries(body.columnMapping||{})){
            if(!/^[a-z][a-z0-9_]{1,40}$/.test(field))continue;
            if(headers.includes(String(source)))columnMapping[field]=String(source);
          }
          const previous=await getSetting(env,"catalog_template",{});
          const content=typeof body.content==="string"?body.content:String(previous.content||"");
          if(content.length>50000)return json({error:"CSV-шаблон слишком большой. Максимум 50 КБ"},413);
          const template={name:String(body.name||"Шаблон каталога.csv").slice(0,120),headers,columnMapping,content,updatedAt:now()};
          const catalog=await getCatalogConfig(env);
          await setSetting(env,"catalog_template",template,staff.id);
          await setSetting(env,"catalog_config",{...catalog,columnMapping},staff.id);
          await logSystem(env,"info","catalog","Обновлён шаблон и сопоставление столбцов",{headers:headers.length,mapped:Object.keys(columnMapping).length});
          return json({success:true,template});
        }
        if(path==="/api/admin/config/export"&&request.method==="GET"){
          const config={...await getConfig(env)};
          if(!hasPermission(staff,"schedule"))for(const key of ["weeklyHours","slotMinutes","leadMinutes","daysAhead","slotCapacity"])delete config[key];
          if(!hasPermission(staff,"branding"))for(const key of ["brandTagline","logoUrl","heroTitle","heroSubtitle","theme","storefrontLayout","defaultSort","analyticsEnabled"])delete config[key];
          delete config.transferDetails;
          const template=hasPermission(staff,"catalog")?await getSetting(env,"catalog_template",{name:"",headers:[],columnMapping:{}}):{name:"",headers:[],columnMapping:{}};
          
          const adminAppearance=hasPermission(staff,"branding")?sanitizeAdminAppearance(await getSetting(env,"admin_appearance",DEFAULT_ADMIN_APPEARANCE)):null;
          return json({schemaVersion:1,exportedAt:now(),store:config,catalogTemplate:template,adminAppearance});
        }
        if(path==="/api/admin/config/import"&&request.method==="POST"){
          const body=await bodyJson(request);
          if(!body||body.schemaVersion!==1)return json({error:"Неподдерживаемая версия файла настроек"},400);
          const current=await getConfig(env);
          const imported=body.store&&typeof body.store==="object"?body.store:{};
          const allowed=["storeName","currency","metroEnabled","pickupEnabled","deliveryEnabled","minOrder","deliveryFee","address","phone"];
          if(hasPermission(staff,"branding.manage"))allowed.push("brandTagline","logoUrl","heroTitle","heroSubtitle","theme","storefrontLayout","defaultSort","analyticsEnabled");
          if(hasPermission(staff,"schedule.manage"))allowed.push("weeklyHours","slotMinutes","leadMinutes","daysAhead","slotCapacity");
          const next={...current};
          for(const key of allowed)if(imported[key]!==undefined)next[key]=imported[key];
          next.storeName=String(next.storeName||"Магазин").trim().slice(0,80);
          next.theme=sanitizeTheme(next.theme);
          next.storefrontLayout=sanitizeStorefrontLayout(next.storefrontLayout,current.storefrontLayout);
          next.defaultSort=["featured","analytics","price-asc","price-desc","name","brand"].includes(next.defaultSort)?next.defaultSort:"featured";
          next.minOrder=Math.max(0,Number(next.minOrder)||0);next.deliveryFee=Math.max(0,Number(next.deliveryFee)||0);
          await setSetting(env,"store_config",next,staff.id);
          if(body.adminAppearance&&hasPermission(staff,"branding.manage"))await setSetting(env,"admin_appearance",sanitizeAdminAppearance(body.adminAppearance),staff.id);
          
          if(body.catalogTemplate&&Array.isArray(body.catalogTemplate.headers)&&hasPermission(staff,"catalog.manage")){
            const headers=body.catalogTemplate.headers.slice(0,100).map(value=>String(value).slice(0,100));
            const mapping={};
            for(const [field,source] of Object.entries(body.catalogTemplate.columnMapping||{}))if(headers.includes(String(source)))mapping[field]=String(source);
            const templateContent=typeof body.catalogTemplate.content==="string"?body.catalogTemplate.content:"";
            if(templateContent.length>50000)return json({error:"Файл шаблона в конфигурации слишком большой"},413);
            await setSetting(env,"catalog_template",{name:String(body.catalogTemplate.name||"Шаблон каталога").slice(0,120),headers,columnMapping:mapping,content:templateContent,updatedAt:now()},staff.id);
            const catalog=await getCatalogConfig(env);
            await setSetting(env,"catalog_config",{...catalog,columnMapping:mapping},staff.id);
          }
          await logSystem(env,"info","settings","Импортирована конфигурация магазина",{staffId:staff.id});
          return json({success:true});
        }
        if(path==="/api/admin/dashboard"&&request.method==="GET")return json(await dashboard(env));
        if(path==="/api/admin/orders"&&request.method==="GET"){
          const status=url.searchParams.get("status")||"";
          const rows=status
            ?await all(env,"SELECT id FROM orders WHERE status=? ORDER BY created_at DESC LIMIT 200",[status])
            :await all(env,"SELECT id FROM orders ORDER BY created_at DESC LIMIT 200");
          const orders=await Promise.all(rows.map(row=>loadOrder(env,row.id)));
          return json({orders:orders.filter(Boolean).map(adminOrder)});
        }
        const adminOrderMatch=path.match(/^\/api\/admin\/orders\/([^/]+)$/);
        if(adminOrderMatch&&request.method==="PATCH"){
          const body=await bodyJson(request);
          let order=await loadOrder(env,adminOrderMatch[1]);
          if(!order)return json({error:"Заказ не найден"},404);
          if(body?.status){
            const result=await updateOrderStatus(env,adminOrderMatch[1],String(body.status),staff,String(body.message||""),body.courierId||null);
            if(result.error)return json({error:result.error},result.status);
            order=result.order;
          }
          if(body?.paymentStatus!==undefined){
            const paymentStatus=String(body.paymentStatus);
            if(!["unpaid","paid","refunded","failed"].includes(paymentStatus))return json({error:"Некорректный статус оплаты"},400);
            await env.DB.batch([
              env.DB.prepare("UPDATE orders SET payment_status=?,updated_at=?,version=version+1 WHERE id=?").bind(paymentStatus,now(),adminOrderMatch[1]),
              env.DB.prepare("INSERT INTO order_events(order_id,actor_id,actor_role,event_type,message,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(adminOrderMatch[1],staff.id,staff.role,"payment_updated","Статус оплаты обновлён",JSON.stringify({paymentStatus}),now())
            ]);
            order=await loadOrder(env,adminOrderMatch[1]);
            await logSystem(env,"info","orders","Обновлён статус оплаты",{orderId:adminOrderMatch[1],paymentStatus,staffId:staff.id});
          }
          return json({success:true,order:adminOrder(order)});
        }
        if(path==="/api/admin/branding"&&request.method==="GET"){
          return json({...storefrontAppearance(await getConfig(env)),_revision:await storeConfigRevision(env)});
        }
        if(path==="/api/admin/branding"&&request.method==="PUT"){
          const body=await bodyJson(request);
          if(!body||typeof body!=="object")return json({error:"Некорректные настройки оформления"},400);
          const current=await getConfig(env);
          const next={...current};
          for(const key of ["brandTagline","logoUrl","heroTitle","heroSubtitle","defaultSort","analyticsEnabled"])if(body[key]!==undefined)next[key]=body[key];
          next.brandTagline=String(next.brandTagline||"").trim().slice(0,120);
          next.logoUrl=String(next.logoUrl||"").trim().slice(0,500);
          next.heroTitle=String(next.heroTitle||"Каталог").trim().slice(0,80);
          next.heroSubtitle=String(next.heroSubtitle||"").trim().slice(0,180);
          next.theme=sanitizeTheme(body.theme||{},current.theme);
          next.storefrontLayout=sanitizeStorefrontLayout(body.storefrontLayout,current.storefrontLayout);
          if(!["featured","analytics","price-asc","price-desc","name","brand"].includes(next.defaultSort))next.defaultSort="featured";
          next.analyticsEnabled=next.analyticsEnabled!==false;
          const revision=await saveStoreConfig(env,next,staff.id,body._revision);
          if(!revision)return json({error:"Настройки уже изменились другим сотрудником. Обновите страницу и повторите действие."},409);
          await logSystem(env,"info","branding","Обновлён интерфейс витрины",{staffId:staff.id});
          return json({success:true,settings:{...storefrontAppearance(next),_revision:revision}});
        }
        if(path==="/api/admin/schedule-settings"&&request.method==="GET"){
          const config=await getConfig(env);
          return json({weeklyHours:config.weeklyHours||DEFAULT_CONFIG.weeklyHours,slotMinutes:config.slotMinutes,leadMinutes:config.leadMinutes,daysAhead:config.daysAhead,slotCapacity:config.slotCapacity});
        }
        if(path==="/api/admin/schedule-settings"&&request.method==="PUT"){
          const body=await bodyJson(request);
          if(!body||typeof body!=="object")return json({error:"Некорректные настройки расписания"},400);
          const current=await getConfig(env),next={...current};
          if(body.weeklyHours&&typeof body.weeklyHours==="object"){
            const days=["mon","tue","wed","thu","fri","sat","sun"],hours={};
            for(const day of days){
              const previous=current.weeklyHours?.[day]||DEFAULT_CONFIG.weeklyHours[day],value=body.weeklyHours[day]||previous;
              const open=String(value.open??previous.open),close=String(value.close??previous.close),closed=value.closed===true;
              if(minutesOf(open)<0||minutesOf(close)<0||(!closed&&minutesOf(close)<=minutesOf(open)))return json({error:"Проверьте время работы для "+day},400);
              hours[day]={open,close,closed};
            }
            next.weeklyHours=hours;
          }
          const bounded=(value,previous,min,max)=>{if(value===undefined)return previous;const number=Number(value);return Number.isFinite(number)?Math.max(min,Math.min(max,Math.round(number))):previous;};
          next.slotMinutes=bounded(body.slotMinutes,current.slotMinutes,15,240);
          next.leadMinutes=bounded(body.leadMinutes,current.leadMinutes,0,1440);
          next.daysAhead=bounded(body.daysAhead,current.daysAhead,1,30);
          next.slotCapacity=bounded(body.slotCapacity,current.slotCapacity,1,100);
          const revision=await saveStoreConfig(env,next,staff.id,body._revision);
          if(!revision)return json({error:"Настройки уже изменились другим сотрудником. Обновите страницу и повторите действие."},409);
          await logSystem(env,"info","schedule","Обновлено расписание магазина",{staffId:staff.id});
          return json({success:true,settings:{weeklyHours:next.weeklyHours,slotMinutes:next.slotMinutes,leadMinutes:next.leadMinutes,daysAhead:next.daysAhead,slotCapacity:next.slotCapacity,_revision:revision}});
        }
        if(path==="/api/admin/settings"&&request.method==="GET"){
          const config={...await getConfig(env)};
          if(!hasPermission(staff,"schedule"))for(const key of ["weeklyHours","slotMinutes","leadMinutes","daysAhead","slotCapacity"])delete config[key];
          if(!hasPermission(staff,"branding"))for(const key of ["brandTagline","logoUrl","heroTitle","heroSubtitle","theme","defaultSort","analyticsEnabled"])delete config[key];
          config._revision=await storeConfigRevision(env);
          return json(config);
        }
        if(path==="/api/admin/settings"&&request.method==="PUT"){
          const body=await bodyJson(request);
          if(!body||typeof body!=="object")return json({error:"Некорректные настройки"},400);
          const current=await getConfig(env);
          const next={...current};
          const allowed=["storeName","currency","metroEnabled","pickupEnabled","deliveryEnabled","minOrder","deliveryFee","address","phone"];
          for(const key of allowed)if(body[key]!==undefined)next[key]=body[key];
          for(const key of ["ageGateEnabled","cashPaymentEnabled","transferPaymentEnabled"]){
            if(body[key]===undefined)continue;
            if(typeof body[key]!=="boolean")return json({error:"Некорректное значение переключателя"},400);
            next[key]=body[key];
          }
          if(body.transferDetails!==undefined){
            if(typeof body.transferDetails!=="string"||body.transferDetails.trim().length>1500)return json({error:"Реквизиты должны содержать до 1500 символов"},400);
            next.transferDetails=body.transferDetails.trim();
          }
          if(next.transferPaymentEnabled&&!next.transferDetails)return json({error:"Добавьте реквизиты для перевода"},400);
          if(!next.cashPaymentEnabled&&!next.transferPaymentEnabled)return json({error:"Оставьте включённым хотя бы один способ оплаты"},400);
          if(body.maxItemQuantity!==undefined){
            const limit=Number(body.maxItemQuantity);
            if(!Number.isInteger(limit)||limit<1||limit>100)return json({error:"Лимит количества должен быть целым числом от 1 до 100"},400);
            next.maxItemQuantity=limit;
          }
          if(body.metroMeetingHint!==undefined)next.metroMeetingHint=String(body.metroMeetingHint).trim().slice(0,250);
          next.slotMinutes=Math.max(15,Math.min(240,Number(next.slotMinutes)||60));
          next.leadMinutes=Math.max(0,Math.min(1440,Number(next.leadMinutes)||0));
          next.daysAhead=Math.max(1,Math.min(30,Number(next.daysAhead)||7));
          next.slotCapacity=Math.max(1,Math.min(100,Number(next.slotCapacity)||4));
          next.minOrder=Math.max(0,Number(next.minOrder)||0);
          next.deliveryFee=Math.max(0,Number(next.deliveryFee)||0);
          next.metroEnabled=next.metroEnabled!==false;
          next.pickupEnabled=next.pickupEnabled!==false;
          next.deliveryEnabled=next.deliveryEnabled===true;
          if(!next.metroEnabled&&!next.pickupEnabled&&!next.deliveryEnabled)return json({error:"Оставьте включённым хотя бы один способ получения"},400);
          next.storeName=String(next.storeName||"Магазин").trim().slice(0,80);
          next.brandTagline=String(next.brandTagline||"").trim().slice(0,120);
          next.logoUrl=String(next.logoUrl||"").trim().slice(0,500);
          next.heroTitle=String(next.heroTitle||"Каталог").trim().slice(0,80);
          next.heroSubtitle=String(next.heroSubtitle||"").trim().slice(0,180);
          next.theme=sanitizeTheme(body.theme||{},current.theme);
          if(!["featured","analytics","price-asc","price-desc","name","brand"].includes(next.defaultSort))next.defaultSort="featured";
          next.analyticsEnabled=next.analyticsEnabled!==false;
          const revision=await saveStoreConfig(env,next,staff.id,body._revision);
          if(!revision)return json({error:"Настройки уже изменились другим сотрудником. Обновите страницу и повторите действие."},409);
          await logSystem(env,"info","settings","Настройки магазина обновлены",{staffId:staff.id});
          return json({success:true,settings:{...next,_revision:revision}});
        }
        if(path==="/api/admin/slot-blocks"&&request.method==="GET"){
          return json({blocks:await all(env,"SELECT * FROM slot_blocks ORDER BY slot_date,start_time LIMIT 200")});
        }
        if(path==="/api/admin/slot-blocks"&&request.method==="POST"){
          const body=await bodyJson(request);
          const date=String(body?.date||"");
          const start=String(body?.startTime||"00:00");
          const end=String(body?.endTime||"23:59");
          const method=["metro","pickup","delivery","all"].includes(body?.method)?body.method:"all";
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||minutesOf(start)<0||minutesOf(end)<=minutesOf(start))return json({error:"Проверьте дату и время"},400);
          const id=randomId();
          await run(env,"INSERT INTO slot_blocks(id,slot_date,start_time,end_time,method,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)",
            [id,date,start,end,method,String(body.reason||"Закрыто менеджером").slice(0,200),staff.id,now()]);
          await logSystem(env,"info","slots","Добавлено ограничение слота",{date,start,end,method});
          return json({success:true,id});
        }
        const blockMatch=path.match(/^\/api\/admin\/slot-blocks\/([^/]+)$/);
        if(blockMatch&&request.method==="DELETE"){
          await run(env,"DELETE FROM slot_blocks WHERE id=?",[blockMatch[1]]);
          return json({success:true});
        }
        if(path==="/api/admin/couriers"&&request.method==="GET"){
          const couriers=await all(env,"SELECT id,display_name,active FROM staff WHERE role='courier' AND active=1 ORDER BY display_name");
          return json({couriers});
        }
        if(path==="/api/admin/staff"&&request.method==="GET"){
          const members=await all(env,"SELECT id,display_name,role,telegram_id,permissions_json,active,created_at,last_seen_at FROM staff ORDER BY created_at");
          return json({staff:members.map(member=>{let permissions=[];try{permissions=JSON.parse(member.permissions_json||"[]");}catch{}return {...member,permissions:normalizePermissions(permissions,member.role)};})});
        }
        if(path==="/api/admin/invites"&&request.method==="POST"){
          const body=await bodyJson(request);
          const role=["manager","courier"].includes(body?.role)?body.role:"courier";
          const displayName=String(body?.displayName||"").trim().slice(0,80);
          const telegramId=String(body?.telegramId||"").trim().slice(0,40);
          if(displayName.length<2)return json({error:"Укажите имя сотрудника"},400);
          const permissions=normalizePermissions(body?.permissions,role);
          if(role==="manager"&&!permissions.length)return json({error:"Выберите хотя бы одно разрешение менеджеру"},400);
          const code=randomToken(16),id=randomId(),created=now(),expires=new Date(Date.now()+48*3600000).toISOString();
          await run(env,"INSERT INTO staff_invites(id,code_hash,display_name,role,telegram_id,permissions_json,active,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,1,?,?,?)",
            [id,await sha256(code),displayName,role,telegramId||null,JSON.stringify(permissions),staff.id,created,expires]);
          return json({success:true,invite:{id,code,displayName,role,permissions,expiresAt:expires}});
        }
        const staffMatch=path.match(/^\/api\/admin\/staff\/([^/]+)$/);
        if(staffMatch&&request.method==="PATCH"){
          const body=await bodyJson(request);
          const target=await first(env,"SELECT id,role FROM staff WHERE id=?",[staffMatch[1]]);
          if(!target)return json({error:"Сотрудник не найден"},404);
          if(target.role==="owner")return json({error:"Права владельца нельзя изменить через список сотрудников"},403);
          if(staffMatch[1]===staff.id&&body?.active===false)return json({error:"Нельзя отключить текущую сессию"},400);
          if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"Некорректные данные сотрудника"},400);
          const fields=[],values=[];
          let revoke=false;
          if(body.telegramId!==undefined){
            if(typeof body.telegramId!=="string"||body.telegramId.trim().length>40)return json({error:"Некорректный Telegram ID"},400);
            fields.push("telegram_id=?");values.push(body.telegramId.trim()||null);revoke=true;
          }
          if(body.active!==undefined){
            if(typeof body.active!=="boolean")return json({error:"Некорректное состояние сотрудника"},400);
            fields.push("active=?");values.push(body.active?1:0);revoke=true;
          }
          if(body.permissions!==undefined){
            if(!Array.isArray(body.permissions))return json({error:"Некорректный список разрешений"},400);
            const permissions=normalizePermissions(body.permissions,target.role);
            if(target.role==="manager"&&!permissions.length)return json({error:"Выберите хотя бы одно разрешение менеджеру"},400);
            fields.push("permissions_json=?");values.push(JSON.stringify(permissions));revoke=true;
          }
          if(fields.length){
            const statements=[env.DB.prepare("UPDATE staff SET "+fields.join(",")+" WHERE id=? AND role!='owner'").bind(...values,staffMatch[1])];
            if(revoke)statements.push(env.DB.prepare("DELETE FROM sessions WHERE staff_id=? AND EXISTS(SELECT 1 FROM staff WHERE id=? AND role!='owner')").bind(staffMatch[1],staffMatch[1]));
            await env.DB.batch(statements);
          }
          return json({success:true});
        }
        if(path==="/api/admin/catalog/products"&&request.method==="GET"){
          const payload=await readCatalog(env);
          return json({products:publicCatalog(payload).products});
        }
        if(path==="/api/admin/catalog/products"&&request.method==="PUT"){
          return json({error:"Товары редактируются в Google Sheets. Независимое сохранение вне таблицы отключено."},409);
        }
        if(path==="/api/admin/sync-settings"&&request.method==="GET")return json(await getCatalogConfig(env));
        if(path==="/api/admin/sync-settings"&&request.method==="PUT"){
          const body=await bodyJson(request);
          const current=await getCatalogConfig(env);
          const spreadsheetId=String(body?.spreadsheetId||current.spreadsheetId).trim();
          const catalogGid=String(body?.catalogGid||current.catalogGid).trim();
          const cacheSeconds=Math.max(60,Math.min(240,Number(body?.cacheSeconds)||current.cacheSeconds));
          const columnMapping=body?.columnMapping&&typeof body.columnMapping==="object"?body.columnMapping:current.columnMapping||{};
          const categoriesGid=String(body?.categoriesGid||current.categoriesGid||"");
          if(!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)||!/^\d+$/.test(catalogGid))return json({error:"Проверьте ID таблицы и GID листа"},400);
          await setSetting(env,"catalog_config",{spreadsheetId,catalogGid,categoriesGid,cacheSeconds,columnMapping},staff.id);
          // Source settings are included in the cache key; no unversioned deletion.
          await logSystem(env,"info","catalog","Изменены настройки источника каталога",{spreadsheetId,catalogGid,cacheSeconds});
          return json({success:true,settings:{spreadsheetId,catalogGid,cacheSeconds,columnMapping}});
        }
        if(path==="/api/admin/sync"&&request.method==="POST"){
          try{return json({success:true,summary:await syncCatalog(env)});}
          catch(error){return json({error:String(error.message||error).slice(0,500)},502);}
        }
        if(path==="/api/admin/sync-runs"&&request.method==="GET"){
          return json({runs:await all(env,"SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 50")});
        }
        if(path==="/api/admin/logs"&&request.method==="GET"){
          const level=url.searchParams.get("level")||"";
          const logs=level?await all(env,"SELECT * FROM system_logs WHERE level=? ORDER BY created_at DESC LIMIT 200",[level]):await all(env,"SELECT * FROM system_logs ORDER BY created_at DESC LIMIT 200");
          return json({logs});
        }
        if(path==="/api/admin/integrations"&&request.method==="GET"){
          return json({botConfigured:!!env.BOT_TOKEN,managerChatId:await getSetting(env,"manager_chat_id",""),webhookConfigured:!!(await getSetting(env,"telegram_webhook_secret",""))});
        }
        if(path==="/api/admin/integrations"&&request.method==="PUT"){
          const body=await bodyJson(request);
          await setSetting(env,"manager_chat_id",String(body?.managerChatId||"").trim().slice(0,80),staff.id);
          return json({success:true,botConfigured:!!env.BOT_TOKEN});
        }
        if(path==="/api/admin/integrations/webhook"&&request.method==="POST"){
          if(!env.BOT_TOKEN)return json({error:"Сначала добавьте BOT_TOKEN в Cloudflare Worker → Settings → Variables and Secrets"},409);
          const secret=randomToken(24);
          await setSetting(env,"telegram_webhook_secret",secret,staff.id);
          const webhookUrl=new URL("/api/telegram/webhook",request.url).toString();
          const response=await telegramCall(env,"setWebhook",{url:webhookUrl,secret_token:secret,allowed_updates:["message","callback_query"]});
          const appUrl=new URL("/",request.url).toString();
          await Promise.all([
            telegramCall(env,"setMyCommands",{commands:[{command:"start",description:"Открыть магазин"},{command:"shop",description:"Каталог"},{command:"orders",description:"Мои заказы"},{command:"help",description:"Помощь"}]}),
            telegramCall(env,"setChatMenuButton",{menu_button:{type:"web_app",text:"Магазин",web_app:{url:appUrl}}})
          ]);
          return json({success:true,webhook:response.result});
        }
      }
      if(request.method==="GET"&&["/rules","/privacy"].includes(path))return textResponse(publicInfoPage(path));
      if(["GET","HEAD"].includes(request.method)&&(path==="/"||path==="/index.html"))return textResponse(request.method==="HEAD"?null:storefrontHtml);
      if(request.method==="GET"&&(path==="/admin"||path==="/admin/"))return textResponse(adminHtml);
      if(request.method==="GET"&&(path==="/courier"||path==="/courier/"))return textResponse(adminHtml);
      return json({error:"Not found"},404);
    }catch(error){
      // Request paths and exception text can contain customer data or credentials.
      console.error(JSON.stringify(operationalEvent("worker_request_failed")));
      await logSystem(env,"error","api","Необработанная ошибка API",{});
      return json({error:"Внутренняя ошибка сервера"},500);
    }
  }
};


