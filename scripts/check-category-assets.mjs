import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const expected = [
  "beer.png",
  "consumables.png",
  "disposable-devices.png",
  "energy-drinks.png",
  "hookahs.png",
  "liquids.png",
  "pod-systems.png",
  "snus.png",
  "tobacco-products.png",
];

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

for (const filename of expected) {
  const bytes = await readFile(new URL(`assets/category-icons/thumbs/${filename}`, root));
  if (bytes.length < 100 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`Invalid optimized category PNG: ${filename}`);
  }
}

console.log(`Category asset validation passed for ${expected.length} optimized PNGs.`);
