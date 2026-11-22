import { readFile, writeFile } from "node:fs/promises";

const pairs = [
  ["index.html", "site.mjs", "html"],
  ["admin.html", "admin.mjs", "adminHtml"],
];

for (const [source, target, exportName] of pairs) {
  const content = await readFile(new URL(`../${source}`, import.meta.url), "utf8");
  await writeFile(new URL(`../${target}`, import.meta.url), `export const ${exportName} = ${JSON.stringify(content)};\n`);
}
