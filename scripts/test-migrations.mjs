#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const wrangler = process.platform === "win32" ? "npx.cmd" : "npx";
const persistTo = await mkdtemp(path.join(tmpdir(), "violet-d1-migrations-"));

function run(args) {
  const result = spawnSync(wrangler, ["wrangler", ...args], {
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    throw new Error([result.stdout, result.stderr].filter(Boolean).join("\n").trim());
  }
  return result.stdout;
}

try {
  run(["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo, "--config", "wrangler.jsonc"]);
  run([
    "d1", "execute", "DB", "--local", "--persist-to", persistTo, "--config", "wrangler.jsonc",
    "--command", "INSERT INTO slot_blocks(id,slot_date,start_time,method,created_at) VALUES('metro-check','2030-01-01','12:00','metro','2030-01-01T00:00:00Z');"
  ]);
  const output = run([
    "d1", "execute", "DB", "--local", "--persist-to", persistTo, "--config", "wrangler.jsonc",
    "--command", "SELECT method FROM slot_blocks WHERE id='metro-check';", "--json"
  ]);
  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed.flatMap(item => item.results || []) : [];
  if (!rows.some(row => row.method === "metro")) throw new Error("Metro slot constraint was not applied");
  console.log("D1 migrations: clean database and metro constraint OK");
} finally {
  await rm(persistTo, { recursive: true, force: true });
}
