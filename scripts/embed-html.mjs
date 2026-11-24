import { readFile, writeFile } from "node:fs/promises";

const pairs = [
  ["index.html", "site.mjs", "html"],
  ["admin.html", "admin.mjs", "adminHtml"],
];
const check = process.argv.includes("--check");
for (const [source, target, exportName] of pairs) {
  const content = await readFile(new URL(`../${source}`, import.meta.url), "utf8");
  const expected = `export const ${exportName} = ${JSON.stringify(content)};\n`;
  const targetUrl = new URL(`../${target}`, import.meta.url);
  if (check) {
    if (await readFile(targetUrl, "utf8") !== expected) {
      console.error(target + " is out of date. Run npm run embed.");
      process.exitCode = 1;
    }
  } else {
    await writeFile(targetUrl, expected);
  }
}
