#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_FILES = ["worker.mjs", "catalog.mjs", "promotions.mjs", "site.mjs", "admin.mjs"];
const WRANGLER = process.platform === "win32" ? "npx.cmd" : "npx";

function runWrangler(args, options = {}) {
  const result = spawnSync(WRANGLER, ["wrangler", ...args], {
    cwd: options.cwd || ROOT,
    encoding: "utf8",
    input: options.input,
    windowsHide: true,
    shell: process.platform === "win32"
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(output || "Команда Wrangler завершилась с ошибкой");
  return output;
}

function databaseIdFrom(output) {
  const direct = output.match(/database_id\s*=\s*["']?([0-9a-f-]{36})/i)
    || output.match(/"database_id"\s*:\s*"([0-9a-f-]{36})"/i)
    || output.match(/"uuid"\s*:\s*"([0-9a-f-]{36})"/i);
  return direct?.[1] || "";
}

function deployedUrl(output) {
  return output.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/i)?.[0] || "";
}

async function exists(target) {
  try { await access(target); return true; } catch { return false; }
}

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const slug = (await rl.question("Короткий ID магазина (латиница, например north-shop): ")).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) {
      throw new Error("ID должен содержать 3–32 символа: латиница, цифры и дефисы.");
    }
    const storeName = (await rl.question("Название магазина: ")).trim();
    if (storeName.length < 2 || storeName.length > 80) throw new Error("Название должно содержать от 2 до 80 символов.");

    const deploymentDir = path.join(ROOT, "deployments", slug);
    if (await exists(deploymentDir)) throw new Error("Папка deployments/" + slug + " уже существует. Выберите другой ID.");

    console.log("\nПроверяю авторизацию Cloudflare…");
    runWrangler(["whoami"]);

    const databaseName = slug + "-db";
    console.log("Создаю отдельную базу D1: " + databaseName);
    let createOutput = "";
    try {
      createOutput = runWrangler(["d1", "create", databaseName, "--location", "eeur"]);
    } catch (error) {
      throw new Error("Не удалось создать D1. Проверьте Cloudflare-доступ.\n" + error.message);
    }
    let databaseId = databaseIdFrom(createOutput);
    if (!databaseId) {
      const info = runWrangler(["d1", "info", databaseName, "--json"]);
      databaseId = databaseIdFrom(info);
    }
    if (!databaseId) throw new Error("D1 создана, но не удалось прочитать её database_id. Запустите wrangler d1 info " + databaseName + " --json и завершите настройку вручную.");

    await mkdir(deploymentDir, { recursive: true });
    for (const file of SOURCE_FILES) await cp(path.join(ROOT, file), path.join(deploymentDir, file));
    await cp(path.join(ROOT, "lib"), path.join(deploymentDir, "lib"), { recursive: true });
    await cp(path.join(ROOT, "migrations"), path.join(deploymentDir, "migrations"), { recursive: true });

    const config = {
      "$schema": "node_modules/wrangler/config-schema.json",
      name: slug,
      main: "worker.mjs",
      compatibility_date: "2026-11-21",
      observability: { enabled: true, head_sampling_rate: 1 },
      vars: {
        STORE_NAME: storeName,
        GOOGLE_SHEET_ID: "",
        GOOGLE_CATALOG_GID: ""
      },
      d1_databases: [{
        binding: "DB",
        database_name: databaseName,
        database_id: databaseId,
        migrations_dir: "migrations"
      }]
    };
    await writeFile(path.join(deploymentDir, "wrangler.jsonc"), JSON.stringify(config, null, 2) + "\n", "utf8");
    await writeFile(path.join(deploymentDir, "package.json"), JSON.stringify({
      name: slug,
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        dev: "wrangler dev",
        deploy: "wrangler deploy",
        "db:migrate": "wrangler d1 migrations apply " + databaseName + " --remote"
      },
      devDependencies: { wrangler: "^4.0.0" }
    }, null, 2) + "\n", "utf8");
    await writeFile(path.join(deploymentDir, ".gitignore"), "node_modules/\n.wrangler/\n.dev.vars\n", "utf8");

    console.log("Применяю миграции базы данных…");
    const configPath = path.relative(ROOT, path.join(deploymentDir, "wrangler.jsonc"));
    runWrangler(["d1", "migrations", "apply", databaseName, "--remote", "--config", configPath]);

    console.log("Публикую отдельный Worker…");
    const deployOutput = runWrangler(["deploy", "--config", configPath]);
    const url = deployedUrl(deployOutput);

    const bootstrapCode = randomBytes(24).toString("hex");
    console.log("Создаю одноразовый код первого владельца…");
    runWrangler(["secret", "put", "BOOTSTRAP_CODE", "--config", configPath], {
      input: bootstrapCode + "\n"
    });

    const handoff = [
      "# " + storeName,
      "",
      "Отдельный Worker и D1 созданы мастером запуска.",
      url ? "Витрина: " + url : "URL витрины указан в выводе команды Wrangler.",
      url ? "Админка: " + url + "/admin" : "Админка: откройте путь /admin на URL Worker.",
      "",
      "1. Войдите в админку одноразовым кодом первого владельца.",
      "2. Подключите таблицу заказчика в разделе каталога.",
      "3. Настройте способы получения и расписание.",
      "4. Создайте приглашение менеджеру и передайте ему код.",
      "5. После первого входа владельца удалите BOOTSTRAP_CODE командой: npx wrangler secret delete BOOTSTRAP_CODE --config wrangler.jsonc",
      "",
      "Секреты и код первого владельца в этот файл не записываются."
    ].join("\n");
    await writeFile(path.join(deploymentDir, "HANDOFF.md"), handoff + "\n", "utf8");

    console.log("\nМАГАЗИН СОЗДАН");
    if (url) console.log("Витрина: " + url);
    if (url) console.log("Админка: " + url + "/admin");
    console.log("Папка проекта: deployments/" + slug);
    console.log("\nОДНОРАЗОВЫЙ КОД ПЕРВОГО ВЛАДЕЛЬЦА — сохраните его сейчас:");
    console.log(bootstrapCode);
    console.log("\nДалее: войдите в /admin, подключите Google Sheets и создайте приглашение менеджеру.");
  } finally {
    rl.close();
  }
}

main().catch(error => {
  console.error("\nОшибка мастера: " + (error?.message || String(error)));
  process.exitCode = 1;
});
