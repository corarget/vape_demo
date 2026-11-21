import { loadCatalog } from "./catalog.mjs";
import { html } from "./site.mjs";

const VERSION = "1.0.0";

function json(data, status, extraHeaders) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  }
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

async function catalogResponse(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/catalog", request.url).toString(), { method: "GET" });
  const forceRefresh = new URL(request.url).searchParams.has("refresh");

  if (!forceRefresh) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  try {
    const payload = await loadCatalog({
      spreadsheetId: env.GOOGLE_SHEET_ID,
      catalogGid: env.GOOGLE_CATALOG_GID
    });
    const response = json({ ...payload, version: VERSION }, 200, {
      "Cache-Control": "public, max-age=60",
      "X-Catalog-Source": "google-sheets"
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()).catch(error => {
      console.error(JSON.stringify({ event: "catalog_cache_write_failed", error: String(error) }));
    }));
    return response;
  } catch (error) {
    console.error(JSON.stringify({
      event: "catalog_sync_failed",
      error: error instanceof Error ? error.message : String(error)
    }));
    return json({
      error: "Синхронизация каталога временно недоступна",
      detail: error instanceof Error ? error.message : "Unknown error",
      version: VERSION
    }, 502);
  }
}

function htmlResponse() {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self' 'unsafe-inline' https://telegram.org; connect-src 'self'; base-uri 'self'; object-src 'none'"
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/catalog") {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }
      return catalogResponse(request, env, ctx);
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "violet-shop",
        version: VERSION,
        timestamp: new Date().toISOString()
      }, 200);
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      return htmlResponse();
    }

    return new Response("Не найдено", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" }
    });
  }
};
