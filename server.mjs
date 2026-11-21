import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { loadCatalog } from "./catalog.mjs";

const html = readFileSync(new URL("./index.html", import.meta.url));
const port = Number(process.env.PORT || 3000);
const spreadsheetId = process.env.GOOGLE_SHEET_ID || "1jNoG5NTnJZbNCx7iAq3S1CcuS0J1EDc8BWeW-nzKNtk";
const catalogGid = process.env.GOOGLE_CATALOG_GID || "782461029";

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1:" + port);

  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "violet-shop-local", timestamp: new Date().toISOString() });
    return;
  }

  if (url.pathname === "/api/catalog") {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const payload = await loadCatalog({ spreadsheetId, catalogGid });
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 502, {
        error: "Синхронизация каталога временно недоступна",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (url.pathname !== "/") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Не найдено");
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' https://telegram.org; connect-src 'self'; base-uri 'self'; object-src 'none'"
  });
  response.end(html);
}).listen(port, "127.0.0.1", () => console.log("VIOLET SHOP: http://127.0.0.1:" + port));
