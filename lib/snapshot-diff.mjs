// Generic historical record comparison. No network, storage, or mutation.
const trim=value=>String(value??"").trim();
const key=value=>trim(value).normalize("NFKC").toLowerCase();
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
// Accept records with stable id and a caller-defined normalized value.
// Fingerprints need not contain source values: a digest string works equally well.
export function makeSnapshot(records,source){
  if(!trim(source))throw new Error("Snapshot source is required");
  if(!Array.isArray(records))throw new Error("Records must be an array");
  const groups=new Map();
  for(const record of records){
    const id=key(record?.id);
    if(!id)throw new Error("Missing stable record id");
    if(record.value===undefined)throw new Error("Missing record value");
    const fingerprint=JSON.stringify(canonical(record.value));
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(fingerprint);
  }
  return {version:1,source:trim(source),entries:[...groups].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([id,values])=>[id,values.sort()])};
}
function validate(snapshot){
  if(snapshot?.version!==1||!trim(snapshot.source)||!Array.isArray(snapshot.entries))throw new Error("Invalid snapshot");
  const map=new Map();
  for(const entry of snapshot.entries){
    if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=="string"||!entry[0]||map.has(entry[0])||!Array.isArray(entry[1])||!entry[1].length||entry[1].some(v=>typeof v!=="string"))throw new Error("Invalid snapshot entry");
    map.set(entry[0],entry[1]);
  }
  return map;
}
export function compareSnapshots(previous,current){
  const after=validate(current);
  const before=previous==null?null:validate(previous);
  const total=[...after.values()].reduce((n,values)=>n+values.length,0);
  const duplicateIds=[...after.values()].filter(values=>values.length>1).length;
  if(!before||previous.source!==current.source){
    return {baseline:true,total,duplicateIds,added:null,changed:null,removed:null,unchanged:null};
  }
  let added=0,changed=0,removed=0,unchanged=0;
  for(const id of new Set([...before.keys(),...after.keys()])){
    const old=before.get(id)||[],fresh=after.get(id)||[];
    const counts=new Map();
    for(const value of old)counts.set(value,(counts.get(value)||0)+1);
    let exact=0;
    for(const value of fresh){const count=counts.get(value)||0;if(count){exact++;counts.set(value,count-1);}}
    const oldRemaining=old.length-exact,newRemaining=fresh.length-exact;
    const paired=Math.min(oldRemaining,newRemaining);
    unchanged+=exact;changed+=paired;removed+=oldRemaining-paired;added+=newRemaining-paired;
  }
  return {baseline:false,total,duplicateIds,added,changed,removed,unchanged};
}
