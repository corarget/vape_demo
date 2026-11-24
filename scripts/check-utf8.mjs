import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const skip = new Set([".git", "node_modules", ".wrangler", "deployments", "assets", "work", ".xdg"]);
const extensions = new Set([".mjs", ".js", ".gs", ".html", ".json", ".jsonc", ".sql", ".md", ".yml", ".yaml"]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const failures = [];
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !skip.has(entry.name)) files.push(...await walk(full));
    if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}
const files = await walk(root);
for (const file of files) {
  try {
    const source = decoder.decode(await readFile(file));
    if (source.includes("\uFFFD") && !file.endsWith("check-utf8.mjs")) failures.push(path.relative(root, file) + ": replacement character");
  } catch (error) {
    failures.push(path.relative(root, file) + ": " + error.message);
  }
}
if (failures.length) {
  console.error("UTF-8 validation failed:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("UTF-8 validation passed for " + files.length + " files.");
