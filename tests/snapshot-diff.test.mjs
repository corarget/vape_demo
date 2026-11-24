import test from "node:test";
import assert from "node:assert/strict";
import {makeSnapshot,compareSnapshots} from "../lib/snapshot-diff.mjs";
const rows=[{id:"P-1",value:{name:"Notebook",color:"blue"}},{id:"P-2",value:{name:"Pen",color:"green"}}];
const snap=(records,source="stationery-demo")=>makeSnapshot(records,source);
test("initial or changed source has no invented delta",()=>{
  const first=snap(rows);
  assert.deepEqual(compareSnapshots(null,first),{baseline:true,total:2,duplicateIds:0,added:null,changed:null,removed:null,unchanged:null});
  assert.equal(compareSnapshots(first,snap(rows,"other-source")).baseline,true);
});
test("stable id, field order, case and row reorder do not create changes",()=>{
  const before=snap(rows);
  const after=snap([{id:" p-2 ",value:{color:"green",name:"Pen"}},rows[0]]);
  assert.deepEqual(compareSnapshots(before,after),{baseline:false,total:2,duplicateIds:0,added:0,changed:0,removed:0,unchanged:2});
});
test("added, changed and removed are separate",()=>{
  const before=snap([...rows,{id:"P-3",value:"Eraser"}]);
  const after=snap([rows[0],{id:"P-2",value:{name:"Pen",color:"red"}},{id:"P-4",value:"Ruler"}]);
  assert.deepEqual(compareSnapshots(before,after),{baseline:false,total:3,duplicateIds:0,added:1,changed:1,removed:1,unchanged:1});
});
test("duplicate identifiers preserve multiplicity and match equal records first",()=>{
  const before=snap([{id:"x",value:"red"},{id:"x",value:"blue"},{id:"x",value:"blue"}]);
  const after=snap([{id:"x",value:"green"},{id:"x",value:"blue"}]);
  assert.deepEqual(compareSnapshots(before,after),{baseline:false,total:2,duplicateIds:1,added:0,changed:1,removed:1,unchanged:1});
  assert.equal(compareSnapshots(after,snap([{id:"x",value:"blue"},{id:"x",value:"green"}])).changed,0);
});
test("empty snapshots and invalid identity are handled explicitly",()=>{
  assert.equal(compareSnapshots(snap(rows),snap([])).removed,2);
  assert.throws(()=>snap([{id:"",value:"x"}]),/Missing stable/);
  assert.throws(()=>compareSnapshots({version:9},snap(rows)),/Invalid snapshot/);
  assert.throws(()=>snap([{id:"x"}]),/Missing record value/);
});
