import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = new URL("../", import.meta.url);
const files = ["index.html", "admin.html", "site.mjs", "admin.mjs", "worker.mjs", "catalog.mjs", "promotions.mjs"];
const decoder = new TextDecoder("utf-8", { fatal: true });
const failures = [];

for (const file of files) {
  try {
    const bytes = await readFile(new URL("../" + file, import.meta.url));
    const text = decoder.decode(bytes);
    if (text.includes("\uFFFD")) failures.push(file + ": contains U+FFFD replacement characters");
  } catch (error) {
    failures.push(file + ": " + (error instanceof Error ? error.message : String(error)));
  }
}

if (failures.length) {
  console.error("UTF-8 validation failed:\n" + failures.map(item => "- " + item).join("\n"));
  process.exit(1);
}
console.log("UTF-8 validation passed for " + files.length + " source files.");
