import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
const root = new URL("../", import.meta.url);
for (const directory of ["", "scripts/"]) {
  for (const file of await readdir(new URL(directory, root))) {
    const name = directory + file;
    if (file.endsWith(".mjs")) {
      const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(name, root))], { stdio: "inherit" });
      if (result.status !== 0) process.exitCode = 1;
    }
    if (file.endsWith(".gs")) new Script(await readFile(new URL(name, root), "utf8"), { filename: name });
  }
}
for (const file of ["index.html", "admin.html"]) {
  const html = await readFile(new URL(file, root), "utf8");
  let count = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    new Script(match[2], { filename: file + ":inline-" + (++count) });
  }
  if (!count) throw new Error("No inline scripts found in " + file);
}
if (!process.exitCode) console.log("JavaScript syntax checks passed.");
