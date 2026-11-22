import { loadCatalog, parseCSV } from "./catalog.mjs";
import { html } from "./site.mjs";
import { adminHtml } from "./admin.mjs";

const VERSION = "2.2.0";
const COOKIE = "violet_staff";
const SESSION_DAYS = 30;
const STATUS_LABELS = {
  new:"Новый", confirmed:"Подтверждён", preparing:"Готовится", ready:"Готов",
  assigned:"Назначен курьер", picked_up:"Забран курьером", on_the_way:"В пути",
  delivered:"Доставлен", completed:"Завершён", cancelled:"Отменён", rejected:"Отклонён"
};
const ACTIVE_STATUSES = ["new","confirmed","preparing","ready","assigned","picked_up","on_the_way"];

const DEFAULT_CONFIG = {
  timezone:"Europe/Minsk",currency:"BYN",storeName:"VIOLET SHOP",
  metroEnabled:true,pickupEnabled:true,deliveryEnabled:false,slotMinutes:60,leadMinutes:60,
  daysAhead:7,slotCapacity:4,minOrder:0,deliveryFee:0,address:"",phone:"",
  brandTagline:"",logoUrl:"",heroTitle:"Каталог",heroSubtitle:"Выберите то, что вам нужно",
  theme:{accent:"#80664D",accent2:"#A17D59",background:"#F6F2EA",panel:"#EEE8DE"},
  defaultSort:"featured",analyticsEnabled:true,
  weeklyHours:{
    mon:{open:"10:00",close:"21:00",closed:false},
    tue:{open:"10:00",close:"21:00",closed:false},
    wed:{open:"10:00",close:"21:00",closed:false},
    thu:{open:"10:00",close:"21:00",closed:false},
    fri:{open:"10:00",close:"21:00",closed:false},
    sat:{open:"10:00",close:"21:00",closed:false},
    sun:{open:"10:00",close:"21:00",closed:false}
  }
};

function json(data,status=200,extra={}) {
  const headers=new Headers({
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff"
  });
  for(const [key,value] of Object.entries(extra))headers.set(key,value);
  return new Response(JSON.stringify(data),{status,headers});
}
function textResponse(body,status=200,extra={}) {
  return new Response(body,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin","Content-Security-Policy":"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' https://telegram.org; connect-src 'self'; base-uri 'self'; object-src 'none'",...extra}});
}
function now(){return new Date().toISOString();}
function randomId(){return crypto.randomUUID();}
function randomToken(bytes=24){
  const data=crypto.getRandomValues(new Uint8Array(bytes));
  return [...data].map(value=>value.toString(16).padStart(2,"0")).join("");
}
async function sha256(value){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,"0")).join("");
}
function safeEqual(a,b){
  a=String(a??"");b=String(b??"");
  let result=a.length^b.length;
  const max=Math.max(a.length,b.length);
  for(let i=0;i<max;i++)result|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return result===0;
}
function parseCookie(request,name){
  const raw=request.headers.get("Cookie")||"";
  for(const part of raw.split(";")){
    const index=part.indexOf("=");
    if(index<0)continue;
    if(part.slice(0,index).trim()===name)return decodeURIComponent(part.slice(index+1).trim());
  }
  return "";
}
function cookieHeader(token,maxAge=SESSION_DAYS*86400){
  return COOKIE+"="+encodeURIComponent(token)+"; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age="+maxAge;
}
function clearCookie(){return COOKIE+"=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";}
function validOrigin(request){
  const origin=request.headers.get("Origin");
  return !origin||origin===new URL(request.url).origin;
}
async function bodyJson(request){
  const length=Number(request.headers.get("Content-Length")||0);
  if(length>100000)return null;
  try{return await request.json();}catch{return null;}
}
async function first(env,sql,params=[]){
  let stmt=env.DB.prepare(sql);
  if(params.length)stmt=stmt.bind(...params);
  return await stmt.first();
}
async function all(env,sql,params=[]){
  let stmt=env.DB.prepare(sql);
  if(params.length)stmt=stmt.bind(...params);
  const result=await stmt.all();
  return result.results||[];
}
async function run(env,sql,params=[]){
  let stmt=env.DB.prepare(sql);
  if(params.length)stmt=stmt.bind(...params);
  return await stmt.run();
}
async function logSystem(env,level,area,message,details={}){
  try{
    await run(env,"INSERT INTO system_logs(level,area,message,details_json,created_at) VALUES(?,?,?,?,?)",
      [level,area,String(message).slice(0,500),JSON.stringify(details).slice(0,5000),now()]);
  }catch(error){console.error("system_log_write_failed",String(error));}
}
async function getSetting(env,key,fallback=null){
  const row=await first(env,"SELECT value_json FROM settings WHERE key=?",[key]);
  if(!row)return fallback;
  try{return JSON.parse(row.value_json);}catch{return row.value_json??fallback;}
}
async function setSetting(env,key,value,updatedBy="system"){
  await run(env,"INSERT INTO settings(key,value_json,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
    [key,JSON.stringify(value),now(),updatedBy]);
}
async function getConfig(env){
  const saved=await getSetting(env,"store_config",{});
  return {...DEFAULT_CONFIG,...saved,storeName:String(saved?.storeName||env.STORE_NAME||DEFAULT_CONFIG.storeName),theme:{...DEFAULT_CONFIG.theme,...(saved?.theme||{})},weeklyHours:{...DEFAULT_CONFIG.weeklyHours,...(saved?.weeklyHours||{})}};
}
async function getStaff(request,env){
  const token=parseCookie(request,COOKIE);
  if(!token)return null;
  const idHash=await sha256(token);
  const row=await first(env,
    "SELECT s.id,s.display_name,s.role,s.telegram_id,s.active,ss.expires_at FROM sessions ss JOIN staff s ON s.id=ss.staff_id WHERE ss.id_hash=? AND ss.expires_at>? AND s.active=1",
    [idHash,now()]);
  if(!row)return null;
  return {id:row.id,name:row.display_name,role:row.role,telegramId:row.telegram_id||"",expiresAt:row.expires_at};
}
function isManager(staff){return !!staff&&["owner","manager"].includes(staff.role);}
function unauthorized(){return json({error:"Требуется вход в панель управления" },401);}
async function requireManager(request,env){
  const staff=await getStaff(request,env);
  return isManager(staff)?staff:null;
}
async function requireCourier(request,env){
  const staff=await getStaff(request,env);
  return staff?.role==="courier"?staff:null;
}
async function createSession(env,staffId){
  const token=randomToken(32);
  const idHash=await sha256(token);
  const created=now();
  const expires=new Date(Date.now()+SESSION_DAYS*86400000).toISOString();
  await run(env,"INSERT INTO sessions(id_hash,staff_id,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?)",
    [idHash,staffId,created,expires,created]);
  return token;
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
  return {
    id:order.id,number:order.number,status:order.status,statusLabel:STATUS_LABELS[order.status]||order.status,
    customerName:order.customer_name,deliveryMethod:order.fulfillment_method||order.delivery_method,address:order.address,doorbell:order.doorbell||"",
    slotDate:order.slot_date,slotTime:order.slot_time,comment:order.comment,total:order.total,
    currency:order.currency,deliveryFee:Number(order.delivery_fee||0),paymentMethod:order.payment_method,paymentStatus:order.payment_status,
    createdAt:order.created_at,updatedAt:order.updated_at,
    items:order.items.map(item=>({name:item.product_name,brand:item.manufacturer,variant:item.option_label,quantity:item.quantity,unitPrice:item.unit_price,lineTotal:item.line_total})),
    events:order.events.map(event=>({type:event.event_type,status:event.to_status,message:event.message,createdAt:event.created_at}))
  };
}
function adminOrder(order){
  return {
    ...customerOrder(order),
    phone:order.phone,courierId:order.courier_id,courierName:order.courier_name,
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
    await logSystem(env,"warning","telegram","Не удалось отправить уведомление Telegram",{error:String(error)});
  }
}
async function notifyOrder(env,order,status="new"){
  const config=await getConfig(env);
  const managerChatId=String(await getSetting(env,"manager_chat_id","")||"");
  if(status==="new"){
    const lines=order.items.map(item=>"• "+escapeTelegram(item.product_name)+" / "+escapeTelegram(item.option_label)+" × "+item.quantity).join("\n");
    const message="<b>Новый заказ #"+order.number+"</b>\n"+
      "Покупатель: "+escapeTelegram(order.customer_name)+"\n"+
      "Телефон: "+escapeTelegram(order.phone)+"\n"+
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
          "Клиент: "+escapeTelegram(order.customer_name)+"\nТелефон: "+escapeTelegram(order.phone)+
          "\nАдрес: "+escapeTelegram(order.address||"")+"\nВремя: "+order.slot_date+" "+order.slot_time);
      }
    }
  }
}
function escapeTelegram(value){
  return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
async function verifyTelegramInitData(initData,botToken){
  if(!initData||!botToken)return null;
  try{
    const params=new URLSearchParams(initData);
    const hash=params.get("hash");
    const authDate=Number(params.get("auth_date")||0);
    if(!hash||!authDate||Date.now()/1000-authDate>86400)return null;
    params.delete("hash");
    const checkString=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>key+"="+value).join("\n");
    const encoder=new TextEncoder();
    const key1=await crypto.subtle.importKey("raw",encoder.encode("WebAppData"),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const secret=new Uint8Array(await crypto.subtle.sign("HMAC",key1,encoder.encode(botToken)));
    const key2=await crypto.subtle.importKey("raw",secret,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key2,encoder.encode(checkString)));
    const actual=[...signature].map(v=>v.toString(16).padStart(2,"0")).join("");
    if(!safeEqual(actual,hash))return null;
    const user=JSON.parse(params.get("user")||"null");
    return user&&user.id?user:null;
  }catch{return null;}
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
async function getSlots(env,date,method){
  const config=await getConfig(env);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!["metro","pickup","delivery"].includes(method))return [];
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
    cacheSeconds:Math.max(15,Math.min(600,Number(saved.cacheSeconds)||45)),
    columnMapping:saved.columnMapping&&typeof saved.columnMapping==="object"?saved.columnMapping:{}
  };
}
async function syncCatalog(env){
  const id=randomId(),started=now();
  await run(env,"INSERT INTO sync_runs(id,status,started_at) VALUES(?,?,?)",[id,"running",started]);
  try{
    const catalogConfig=await getCatalogConfig(env);
    if(!catalogConfig.spreadsheetId||!catalogConfig.catalogGid)throw new Error("Подключите Google Sheets в админке → Каталог");
    const payload=await loadCatalog({spreadsheetId:catalogConfig.spreadsheetId,catalogGid:catalogConfig.catalogGid,columnMapping:catalogConfig.columnMapping||{}});
    const details={fields:payload.fields,source:payload.source,categories:payload.categories||[...new Set(payload.products.map(product=>product.category).filter(Boolean))].map(key=>({key,label:key,image:"",icon:"✦"}))};
    await run(env,"UPDATE sync_runs SET status='success',finished_at=?,source_rows=?,product_families=?,variants=?,details_json=? WHERE id=?",
      [now(),payload.sourceRows,payload.productFamilies,payload.variants,JSON.stringify(details),id]);
    await logSystem(env,"info","catalog","Каталог синхронизирован",{
      rows:payload.sourceRows,families:payload.productFamilies,variants:payload.variants
    });
    return payload;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    await run(env,"UPDATE sync_runs SET status='error',finished_at=?,error=? WHERE id=?",[now(),message,id]);
    await logSystem(env,"error","catalog","Ошибка синхронизации каталога",{error:message});
    throw error;
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
      popularity:product.popularity,analyticsScore:product.analyticsScore||0,views30d:product.views30d||0,cartAdds30d:product.cartAdds30d||0,orders30d:product.orders30d||0,sortOrder:product.sortOrder,attributes:product.attributes,
      options:product.options.map(option=>({
        variantId:option.variantId,label:option.label,available:option.available,
        price:option.price,attributes:option.attributes
      }))
    }))
  };
}
async function catalogResponse(request,env,ctx){
  const cache=caches.default;
  const cacheKey=new Request(new URL("/api/catalog",request.url).toString(),{method:"GET"});
  const force=new URL(request.url).searchParams.has("refresh");
  const catalogConfig=await getCatalogConfig(env);
  if(!force){
    const cached=await cache.match(cacheKey);
    if(cached)return cached;
  }
  try{
    const payload=publicCatalog(await syncCatalog(env));
    try{
      const since=new Date(Date.now()-30*86400000).toISOString();
      const signals=await all(env,"SELECT product_id,SUM(CASE WHEN event_type='product_view' THEN 1 ELSE 0 END) AS views,SUM(CASE WHEN event_type='add_to_cart' THEN 1 ELSE 0 END) AS cart_adds,SUM(CASE WHEN event_type='order_created' THEN 1 ELSE 0 END) AS orders FROM analytics_events WHERE created_at>=? GROUP BY product_id",[since]);
      const signalMap=new Map(signals.map(row=>[row.product_id,{views:Number(row.views||0),cartAdds:Number(row.cart_adds||0),orders:Number(row.orders||0)}]));
      payload.products=payload.products.map(product=>{
        const signal=signalMap.get(product.id)||{views:0,cartAdds:0,orders:0};
        return {...product,views30d:signal.views,cartAdds30d:signal.cartAdds,orders30d:signal.orders,analyticsScore:signal.views+signal.cartAdds*4+signal.orders*12};
      });
    }catch(error){await logSystem(env,"warning","analytics","Не удалось рассчитать популярность каталога",{error:String(error)});}
    const response=json({...payload,version:VERSION},200,{"Cache-Control":"public, max-age="+catalogConfig.cacheSeconds,"X-Catalog-Source":"sheets"});
    ctx.waitUntil(cache.put(cacheKey,response.clone()).catch(error=>logSystem(env,"warning","cache","Не удалось сохранить кеш каталога",{error:String(error)})));
    return response;
  }catch(error){
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
  if(!body)return json({error:"Некорректные данные заказа"},400);
  const customerKeyHash=await verifyCustomerToken(request,body);
  if(!customerKeyHash)return json({error:"Не удалось подтвердить сессию покупателя"},400);
  const name=String(body.customerName||"").trim().slice(0,100);
  const phone=String(body.phone||"").trim().slice(0,40);
  const method=["metro","pickup","delivery"].includes(body.deliveryMethod)?body.deliveryMethod:"metro";
  const storageMethod=method==="delivery"?"delivery":"pickup";
  const address=String(body.address||"").trim().slice(0,300);
  const doorbell=method==="delivery"?String(body.doorbell||"").trim().slice(0,80):"";
  const slotDate=String(body.slotDate||"");
  const slotTime=String(body.slotTime||"");
  const comment=String(body.comment||"").trim().slice(0,500);
  const paymentMethod=["cash","card","online"].includes(body.paymentMethod)?body.paymentMethod:"upon_receipt";
  if(name.length<2||phone.length<6)return json({error:"Укажите имя и корректный номер телефона"},400);
  if(method==="delivery"&&address.length<5)return json({error:"Укажите адрес доставки"},400);
  const config=await getConfig(env);
  if(method==="delivery"&&!config.deliveryEnabled)return json({error:"Доставка на дом сейчас недоступна"},409);
  if(method==="pickup"&&!config.pickupEnabled)return json({error:"Самовывоз сейчас недоступен"},409);
  if(method==="metro"&&config.metroEnabled===false)return json({error:"Получение у метро сейчас недоступно"},409);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(slotTime))return json({error:"Выберите время получения"},400);
  const availableSlots=await getSlots(env,slotDate,method);
  if(!availableSlots.some(slot=>slot.time===slotTime))return json({error:"Этот слот уже занят или недоступен. Выберите другое время"},409);
  if(!Array.isArray(body.items)||body.items.length===0||body.items.length>40)return json({error:"Корзина пуста или содержит слишком много позиций"},400);

  let catalog;
  try{const catalogConfig=await getCatalogConfig(env);catalog=await loadCatalog({spreadsheetId:catalogConfig.spreadsheetId,catalogGid:catalogConfig.catalogGid,columnMapping:catalogConfig.columnMapping||{}});}
  catch(error){await logSystem(env,"error","orders","Не удалось проверить каталог при оформлении заказа",{error:String(error)});return json({error:"Не удалось проверить наличие товаров. Попробуйте позже"},503);}
  const products=new Map(catalog.products.map(product=>[product.id,product]));
  const items=[];let total=0;
  for(const raw of body.items){
    const product=products.get(String(raw.productId||""));
    const option=product?.options.find(item=>item.variantId===String(raw.variantId||""));
    const quantity=Math.max(0,Math.min(20,Math.floor(Number(raw.quantity)||0)));
    if(!product||!option||!option.available||quantity<1)return json({error:"Одна из позиций больше недоступна. Обновите корзину"},409);
    const lineTotal=option.price*quantity;
    total+=lineTotal;
    items.push({
      productId:product.id,productKey:option.productKey,sku:option.sku,
      productName:product.name,manufacturer:product.manufacturer,category:product.category,
      optionLabel:option.label,attributes:option.attributes,quantity,
      unitPrice:option.price,lineTotal
    });
  }
  const itemSubtotal=total;
  if(itemSubtotal<Math.max(0,Number(config.minOrder)||0))return json({error:"Минимальная сумма заказа: "+(Number(config.minOrder)/100).toFixed(2)+" BYN"},400);
  const deliveryFee=method==="delivery"?Math.max(0,Number(config.deliveryFee)||0):0;
  total=itemSubtotal+deliveryFee;

  let telegramUser=null;
  if(env.BOT_TOKEN)telegramUser=await verifyTelegramInitData(body.telegramInitData,env.BOT_TOKEN);
  const telegramUserId=telegramUser?String(telegramUser.id):null;
  const orderId=randomId(),createdAt=now();
  const numberResult=await run(env,"INSERT INTO order_numbers(created_at) VALUES(?)",[createdAt]);
  const orderNumber=Number(numberResult.meta?.last_row_id||Date.now());
  const capacity=Number(config.slotCapacity)||4;
  const statements=[
    env.DB.prepare("INSERT INTO orders(id,number,customer_key_hash,telegram_user_id,customer_name,phone,delivery_method,address,fulfillment_method,doorbell,slot_date,slot_time,comment,status,total,delivery_fee,currency,payment_method,payment_status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,'new',?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM orders WHERE slot_date=? AND slot_time=? AND COALESCE(fulfillment_method,delivery_method)=? AND status NOT IN ('cancelled','rejected')) < ?")
      .bind(orderId,String(orderNumber),customerKeyHash,telegramUserId,name,phone,storageMethod,address,method,doorbell,slotDate,slotTime,comment,String(total),String(deliveryFee),config.currency||"BYN",paymentMethod,"unpaid",createdAt,createdAt,slotDate,slotTime,method,String(capacity)),
    ...items.map(item=>env.DB.prepare("INSERT INTO order_items(order_id,product_id,product_key,sku,product_name,manufacturer,option_label,attributes_json,quantity,unit_price,line_total) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)")
      .bind(orderId,item.productId,item.productKey,item.sku,item.productName,item.manufacturer,item.optionLabel,JSON.stringify(item.attributes),String(item.quantity),String(item.unitPrice),String(item.lineTotal),orderId)),
    env.DB.prepare("INSERT INTO order_events(order_id,actor_role,event_type,to_status,message,metadata_json,created_at) SELECT ?,'customer','created','new','Заказ оформлен',?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)")
      .bind(orderId,JSON.stringify({deliveryMethod:method,slotDate,slotTime,doorbell}),createdAt,orderId),
    ...items.map(item=>env.DB.prepare("INSERT INTO analytics_events(event_type,product_id,product_name,category,brand,visitor_hash,created_at) SELECT 'order_created',?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM orders WHERE id=?)")
      .bind(item.productId,item.productName,item.category,item.manufacturer,customerKeyHash,createdAt,orderId))
  ];
  let result;
  try{result=await env.DB.batch(statements);}
  catch(error){
    await logSystem(env,"error","orders","Ошибка записи заказа",{error:String(error)});
    return json({error:"Не удалось сохранить заказ. Попробуйте ещё раз"},500);
  }
  if(!result?.[0]?.meta?.changes)return json({error:"Слот только что заняли. Выберите другое время"},409);
  const order=await loadOrder(env,orderId);
  await notifyOrder(env,order,"new");
  return json({success:true,order:customerOrder(order),orderNumber});
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
  const body=await bodyJson(request);
  const code=String(body?.code||"").trim();
  if(code.length<12||code.length>128)return json({error:"Введите код доступа"},400);
  const codeHash=await sha256(code);
  const bootstrapUsed=await getSetting(env,"bootstrap_used",false);
  const storedBootstrapHash=await getSetting(env,"bootstrap_hash","");
  const bootstrapHash=storedBootstrapHash||(env.BOOTSTRAP_CODE?await sha256(env.BOOTSTRAP_CODE):"");
  let staffId=randomId(),role="manager",displayName=String(body.displayName||"").trim().slice(0,80),telegramId="";
  if(!bootstrapUsed&&bootstrapHash&&safeEqual(codeHash,bootstrapHash)){
    if(displayName.length<2)return json({error:"Укажите имя владельца"},400);
    role="owner";
    await setSetting(env,"bootstrap_used",true,"bootstrap");
    await setSetting(env,"bootstrap_hash","","bootstrap");
  }else{
    const invite=await first(env,"SELECT * FROM staff_invites WHERE code_hash=? AND active=1 AND used_at IS NULL AND expires_at>?",[codeHash,now()]);
    if(!invite)return json({error:"Код недействителен или уже использован"},401);
    role=invite.role;displayName=invite.display_name;telegramId=invite.telegram_id||"";
    await run(env,"UPDATE staff_invites SET active=0,used_at=? WHERE id=?",[now(),invite.id]);
  }
  const created=now();
  try{
    await run(env,"INSERT INTO staff(id,display_name,role,telegram_id,active,created_at,last_seen_at) VALUES(?,?,?,?,1,?,?)",
      [staffId,displayName,role,telegramId||null,created,created]);
    const token=await createSession(env,staffId);
    await logSystem(env,"info","auth","Вход сотрудника",{staffId,role});
    return json({success:true,staff:{id:staffId,name:displayName,role}},200,{"Set-Cookie":cookieHeader(token)});
  }catch(error){
    await logSystem(env,"error","auth","Не удалось создать сессию сотрудника",{error:String(error)});
    return json({error:"Не удалось выполнить вход"},500);
  }
}
async function sourceCategories(env){
  const latest=await first(env,"SELECT details_json FROM sync_runs WHERE status='success' ORDER BY started_at DESC LIMIT 1");
  let categories=[];
  try{categories=JSON.parse(latest?.details_json||"{}").categories||[];}catch{}
  return categories.map((item,index)=>typeof item==="string"?{key:item,label:item,image:"",icon:"",sortOrder:index}:{key:String(item.key||item.label||"Другое"),label:String(item.label||item.key||"Другое"),image:String(item.image||""),icon:String(item.icon||""),sortOrder:index});
}
async function categorySettings(env){
  const [source,saved]=await Promise.all([sourceCategories(env),getSetting(env,"category_config",{})]);
  const result={};
  source.forEach((category,index)=>{
    const override=saved[category.key]||{};
    result[category.key]={key:category.key,label:override.label??category.label,image:override.image??category.image,icon:override.icon??category.icon,active:override.active!==false,sortOrder:override.sortOrder??index,sourceLabel:category.label,sourceImage:category.image};
  });
  return result;
}
async function publicSettings(env){
  const c=await getConfig(env);
  return {
    storeName:c.storeName,currency:c.currency,metroEnabled:c.metroEnabled!==false,pickupEnabled:c.pickupEnabled,
    deliveryEnabled:c.deliveryEnabled,deliveryFee:c.deliveryFee,minOrder:c.minOrder,
    address:c.address,phone:c.phone,daysAhead:c.daysAhead,
    brandTagline:c.brandTagline||"",logoUrl:c.logoUrl||"",heroTitle:c.heroTitle||"Каталог",heroSubtitle:c.heroSubtitle||"",
    theme:c.theme||DEFAULT_CONFIG.theme,defaultSort:c.defaultSort||"featured",analyticsEnabled:c.analyticsEnabled!==false,
    categories:await categorySettings(env)
  };
}
async function recordAnalyticsEvent(request,env){
  const body=await bodyJson(request);
  if(!body)return json({error:"Некорректное событие"},400);
  const allowed=new Set(["product_view","add_to_cart","variant_unavailable_click","search","category_filter","brand_filter","checkout_start","order_created"]);
  const eventType=String(body.eventType||"");
  if(!allowed.has(eventType))return json({error:"Неизвестный тип события"},400);
  const token=String(body.visitorToken||"").slice(0,200);
  const visitorHash=token.length>=16?await sha256(token):null;
  let query=String(body.query||"").trim().slice(0,120);
  if(/@|\d{7,}/.test(query))query="";
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
  if(update.update_id)await run(env,"INSERT OR IGNORE INTO telegram_updates(update_id,received_at,handled) VALUES(?,?,0)",[String(update.update_id),now()]);
  const callback=update.callback_query;
  if(callback?.data){
    const [kind,orderId,action]=String(callback.data).split("|");
    const telegramId=String(callback.from?.id||"");
    const staff=await first(env,"SELECT id,role FROM staff WHERE telegram_id=? AND active=1",[telegramId]);
    if(kind==="order"&&staff&&["owner","manager"].includes(staff.role)){
      const result=await updateOrderStatus(env,orderId,action,{id:staff.id,role:staff.role},"Изменено из Telegram");
      await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id,text:result.error||"Статус обновлён"});
    }else{
      await telegramCall(env,"answerCallbackQuery",{callback_query_id:callback.id,text:"Нет доступа к этому действию",show_alert:true});
    }
  }
  if(update.update_id)await run(env,"UPDATE telegram_updates SET handled=1 WHERE update_id=?",[String(update.update_id)]);
  return json({ok:true});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    const path=url.pathname;
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Allow":"GET,POST,PUT,PATCH,DELETE,OPTIONS"}});
    if(["POST","PUT","PATCH","DELETE"].includes(request.method)&&!validOrigin(request))return json({error:"Origin not allowed"},403);

    try{
      if(path==="/api/health"&&request.method==="GET"){
        const staffCount=await first(env,"SELECT COUNT(*) AS count FROM staff WHERE active=1");
        return json({ok:true,service:"violet-shop",version:VERSION,database:!!env.DB,staff:Number(staffCount?.count||0),timestamp:now()});
      }
      if(path==="/api/catalog"&&request.method==="GET")return await catalogResponse(request,env,ctx);
      if(path==="/api/settings/public"&&request.method==="GET")return json(await publicSettings(env));
      if(path==="/api/analytics/event"&&request.method==="POST")return await recordAnalyticsEvent(request,env);
      if(path==="/api/slots"&&request.method==="GET"){
        const date=url.searchParams.get("date")||"";
        const method=url.searchParams.get("method")||"pickup";
        return json({date,method,slots:await getSlots(env,date,method)});
      }
      if(path==="/api/orders"&&request.method==="POST")return await createOrder(request,env);
      const customerCancelMatch=path.match(/^\/api\/orders\/([^/]+)\/cancel$/);
      if(customerCancelMatch&&request.method==="POST"){
        const body=await bodyJson(request);
        const hash=await verifyCustomerToken(request,body);
        if(!hash)return json({error:"Сессия покупателя не найдена"},401);
        const order=await loadOrder(env,customerCancelMatch[1]);
        if(!order||order.customer_key_hash!==hash)return json({error:"Заказ не найден"},404);
        if(order.status!=="new")return json({error:"Отменить можно только новый заказ. Свяжитесь с магазином"},409);
        const result=await updateOrderStatus(env,order.id,"cancelled",{id:null,role:"customer"},"Отменён покупателем");
        return result.error?json({error:result.error},result.status):json({success:true,order:customerOrder(result.order)});
      }
      if(path==="/api/orders"&&request.method==="GET"){
        const hash=await verifyCustomerToken(request);
        const telegramUser=env.BOT_TOKEN?await verifyTelegramInitData(request.headers.get("X-Telegram-Init-Data")||"",env.BOT_TOKEN):null;
        if(!hash&&!telegramUser)return json({error:"Сессия покупателя не найдена"},401);
        const orders=hash&&telegramUser
          ?await all(env,"SELECT id FROM orders WHERE customer_key_hash=? OR telegram_user_id=? ORDER BY created_at DESC LIMIT 50",[hash,String(telegramUser.id)])
          :hash
            ?await all(env,"SELECT id FROM orders WHERE customer_key_hash=? ORDER BY created_at DESC LIMIT 50",[hash])
            :await all(env,"SELECT id FROM orders WHERE telegram_user_id=? ORDER BY created_at DESC LIMIT 50",[String(telegramUser.id)]);
        const detailed=await Promise.all(orders.map(row=>loadOrder(env,row.id)));
        return json({orders:detailed.filter(Boolean).map(customerOrder)});
      }
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
      const adminOk=isManager(staff);
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
        if(!adminOk)return unauthorized();
        if(path==="/api/admin/analytics"&&request.method==="GET"){
          const days=Math.max(7,Math.min(90,Number(url.searchParams.get("days"))||30));
          return json(await adminAnalytics(env,days));
        }
        if(path==="/api/admin/categories"&&request.method==="GET"){
          return json({categories:Object.values(await categorySettings(env))});
        }
        if(path==="/api/admin/categories"&&request.method==="PUT"){
          const body=await bodyJson(request);
          if(!Array.isArray(body?.categories)||body.categories.length>200)return json({error:"Некорректный список категорий"},400);
          const sourceMap=new Map((await sourceCategories(env)).map(category=>[category.key,category]));
          const config={};
          for(const [index,item] of body.categories.entries()){
            const key=String(item?.key||"").trim().slice(0,100);
            if(!key)continue;
            const source=sourceMap.get(key)||{label:key,image:"",icon:""};
            const label=String(item.label||source.label||key).trim().slice(0,80);
            const image=String(item.image||"").trim().slice(0,500);
            const icon=String(item.icon||source.icon||"").trim().slice(0,8);
            const override={};
            if(label!==source.label)override.label=label;
            if(image!==source.image)override.image=/^https:\/\//i.test(image)?image:"";
            if(icon!==source.icon)override.icon=icon;
            if(item.active===false)override.active=false;
            const rawSortOrder=Number(item.sortOrder);const sortOrder=Math.max(0,Math.min(999,Number.isFinite(rawSortOrder)?rawSortOrder:index));
            if(sortOrder!==source.sortOrder)override.sortOrder=sortOrder;
            config[key]=override;
          }
          await setSetting(env,"category_config",config,staff.id);
          await logSystem(env,"info","catalog","Обновлены настройки категорий",{count:Object.keys(config).length,staffId:staff.id});
          return json({success:true,categories:config});
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
          const config=await getConfig(env);
          const template=await getSetting(env,"catalog_template",{name:"",headers:[],columnMapping:{}});
          return json({schemaVersion:1,exportedAt:now(),store:config,categories:await getSetting(env,"category_config",{}),catalogTemplate:template});
        }
        if(path==="/api/admin/config/import"&&request.method==="POST"){
          const body=await bodyJson(request);
          if(!body||body.schemaVersion!==1)return json({error:"Неподдерживаемая версия файла настроек"},400);
          const current=await getConfig(env);
          const imported=body.store&&typeof body.store==="object"?body.store:{};
          const allowed=["storeName","currency","pickupEnabled","deliveryEnabled","minOrder","deliveryFee","address","phone","weeklyHours","brandTagline","logoUrl","heroTitle","heroSubtitle","theme","defaultSort","analyticsEnabled","slotMinutes","leadMinutes","daysAhead","slotCapacity"];
          const next={...current};
          for(const key of allowed)if(imported[key]!==undefined)next[key]=imported[key];
          next.storeName=String(next.storeName||"Магазин").trim().slice(0,80);
          next.theme={...DEFAULT_CONFIG.theme,...(next.theme||{})};
          const validColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||""));
          for(const key of Object.keys(DEFAULT_CONFIG.theme))if(!validColor(next.theme[key]))next.theme[key]=DEFAULT_CONFIG.theme[key];
          next.defaultSort=["featured","analytics","price-asc","price-desc","name","brand"].includes(next.defaultSort)?next.defaultSort:"featured";
          next.minOrder=Math.max(0,Number(next.minOrder)||0);next.deliveryFee=Math.max(0,Number(next.deliveryFee)||0);
          await setSetting(env,"store_config",next,staff.id);
          if(body.categories&&typeof body.categories==="object")await setSetting(env,"category_config",body.categories,staff.id);
          if(body.catalogTemplate&&Array.isArray(body.catalogTemplate.headers)){
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
              env.DB.prepare("INSERT INTO order_events(order_id,actor_id,actor_role,event_type,message,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)").bind(adminOrderMatch[1],staff.id,staff.role,"payment_updated","Статус оплаты изменён",JSON.stringify({paymentStatus}),now())
            ]);
            order=await loadOrder(env,adminOrderMatch[1]);
            await logSystem(env,"info","orders","Обновлён статус оплаты",{orderId:adminOrderMatch[1],paymentStatus,staffId:staff.id});
          }
          return json({success:true,order:adminOrder(order)});
        }
        if(path==="/api/admin/settings"&&request.method==="GET")return json(await getConfig(env));
        if(path==="/api/admin/settings"&&request.method==="PUT"){
          const body=await bodyJson(request);
          if(!body||typeof body!=="object")return json({error:"Некорректные настройки"},400);
          const current=await getConfig(env);
          const next={...current};
          const allowed=["storeName","currency","metroEnabled","pickupEnabled","deliveryEnabled","slotMinutes","leadMinutes","daysAhead","slotCapacity","minOrder","deliveryFee","address","phone","weeklyHours","brandTagline","logoUrl","heroTitle","heroSubtitle","theme","defaultSort","analyticsEnabled"];
          for(const key of allowed)if(body[key]!==undefined)next[key]=body[key];
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
          const validColor=value=>/^#[0-9a-f]{6}$/i.test(String(value||""));
          const theme={...DEFAULT_CONFIG.theme,...(current.theme||{}),...(body.theme||{})};
          for(const key of Object.keys(DEFAULT_CONFIG.theme))if(!validColor(theme[key]))theme[key]=DEFAULT_CONFIG.theme[key];
          next.theme=theme;
          if(!["featured","analytics","price-asc","price-desc","name","brand"].includes(next.defaultSort))next.defaultSort="featured";
          next.analyticsEnabled=next.analyticsEnabled!==false;
          await setSetting(env,"store_config",next,staff.id);
          await logSystem(env,"info","settings","Настройки магазина обновлены",{staffId:staff.id});
          return json({success:true,settings:next});
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
        if(path==="/api/admin/staff"&&request.method==="GET"){
          const members=await all(env,"SELECT id,display_name,role,telegram_id,active,created_at,last_seen_at FROM staff ORDER BY created_at");
          return json({staff:members});
        }
        if(path==="/api/admin/invites"&&request.method==="POST"){
          const body=await bodyJson(request);
          const role=["manager","courier"].includes(body?.role)?body.role:"courier";
          const displayName=String(body?.displayName||"").trim().slice(0,80);
          const telegramId=String(body?.telegramId||"").trim().slice(0,40);
          if(displayName.length<2)return json({error:"Укажите имя сотрудника"},400);
          const code=randomToken(16),id=randomId(),created=now(),expires=new Date(Date.now()+48*3600000).toISOString();
          await run(env,"INSERT INTO staff_invites(id,code_hash,display_name,role,telegram_id,active,created_by,created_at,expires_at) VALUES(?,?,?,?,?,1,?,?,?)",
            [id,await sha256(code),displayName,role,telegramId||null,staff.id,created,expires]);
          return json({success:true,invite:{id,code,displayName,role,expiresAt:expires}});
        }
        const staffMatch=path.match(/^\/api\/admin\/staff\/([^/]+)$/);
        if(staffMatch&&request.method==="PATCH"){
          const body=await bodyJson(request);
          if(staffMatch[1]===staff.id&&body?.active===false)return json({error:"Нельзя отключить текущую сессию"},400);
          if(body?.telegramId!==undefined){await run(env,"UPDATE staff SET telegram_id=? WHERE id=?",[String(body.telegramId||"").trim()||null,staffMatch[1]]);}
          if(body?.active!==undefined){await run(env,"UPDATE staff SET active=? WHERE id=?",[body.active===false?0:1,staffMatch[1]]);if(body.active===false)await run(env,"DELETE FROM sessions WHERE staff_id=?",[staffMatch[1]]);}
          return json({success:true});
        }
        if(path==="/api/admin/sync-settings"&&request.method==="GET")return json(await getCatalogConfig(env));
        if(path==="/api/admin/sync-settings"&&request.method==="PUT"){
          const body=await bodyJson(request);
          const current=await getCatalogConfig(env);
          const spreadsheetId=String(body?.spreadsheetId||current.spreadsheetId).trim();
          const catalogGid=String(body?.catalogGid||current.catalogGid).trim();
          const cacheSeconds=Math.max(15,Math.min(600,Number(body?.cacheSeconds)||current.cacheSeconds));
          const columnMapping=body?.columnMapping&&typeof body.columnMapping==="object"?body.columnMapping:current.columnMapping||{};
          if(!/^[A-Za-z0-9_-]{20,}$/.test(spreadsheetId)||!/^\d+$/.test(catalogGid))return json({error:"Проверьте ID таблицы и GID листа"},400);
          await setSetting(env,"catalog_config",{spreadsheetId,catalogGid,cacheSeconds,columnMapping},staff.id);
          await caches.default.delete(new Request(new URL("/api/catalog",request.url).toString(),{method:"GET"}));
          await logSystem(env,"info","catalog","Изменены настройки источника каталога",{spreadsheetId,catalogGid,cacheSeconds});
          return json({success:true,settings:{spreadsheetId,catalogGid,cacheSeconds,columnMapping}});
        }
        if(path==="/api/admin/sync"&&request.method==="POST"){
          const payload=await syncCatalog(env);
          const cacheKey=new Request(new URL("/api/catalog",request.url).toString(),{method:"GET"});
          await caches.default.delete(cacheKey);
          return json({success:true,summary:{sourceRows:payload.sourceRows,activeRows:payload.activeRows,productFamilies:payload.productFamilies,variants:payload.variants,updatedAt:payload.updatedAt}});
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
          return json({success:true,webhook:response.result});
        }
      }
      if(request.method==="GET"&&(path==="/"||path==="/index.html"))return textResponse(html);
      if(request.method==="GET"&&(path==="/admin"||path==="/admin/"))return textResponse(adminHtml);
      if(request.method==="GET"&&(path==="/courier"||path==="/courier/"))return textResponse(adminHtml);
      return json({error:"Not found"},404);
    }catch(error){
      console.error("worker_request_failed",path,String(error));
      await logSystem(env,"error","api","Необработанная ошибка API",{path,error:error instanceof Error?error.message:String(error)});
      return json({error:"Внутренняя ошибка сервера"},500);
    }
  }
};
