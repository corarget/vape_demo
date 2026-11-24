import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const worker = await readFile(new URL("worker.mjs", root), "utf8");
const expected = [
  "liquids.png",
  "pod-systems.png",
  "consumables.png",
  "energy-drinks.png",
  "hookahs.png",
  "disposable-devices.png",
];

if (!worker.includes('const CATEGORY_ICON_BASE="/assets/category-icons/"')) {
  throw new Error("Category icons must be served from the Worker's bundled assets");
}

for (const filename of expected) {
  if (!worker.includes(`CATEGORY_ICON_BASE+"${filename}"`)) {
    throw new Error(`Missing category icon mapping for ${filename}`);
  }
  await access(new URL(`assets/category-icons/${filename}`, root));
}

console.log(`Category asset validation passed for ${expected.length} mapped icons.`);

