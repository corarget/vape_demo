import { readFile } from "node:fs/promises";
import { parseCSV } from "../catalog.mjs";
import { auditData } from "../lib/data-contract.mjs";
const [items, categories] = process.argv.slice(2);
if(!items||!categories){console.error("Usage: npm run audit:data -- items.csv categories.csv");process.exitCode=2;}else{
  try {
    const read=async file=>parseCSV(await readFile(file,"utf8"));
    const result=auditData(await read(items),await read(categories));
    console.log(JSON.stringify(result,null,2));
    if(!result.ok)process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=2;}
}
