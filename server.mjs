import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url));
const port = Number(process.env.PORT || 3000);
const spreadsheetId = process.env.GOOGLE_SHEET_ID || '1jNoG5NTnJZbNCx7iAq3S1CcuS0J1EDc8BWeW-nzKNtk';
const catalogGid = process.env.GOOGLE_CATALOG_GID || '782461029';

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i + 1] === '\n') i += 1; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map(value => value.trim()) || [];
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function isTrue(value) { return ['true', '1', 'yes', 'да'].includes(String(value).trim().toLowerCase()); }

async function catalog() {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${catalogGid}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Google Sheets: ${response.status}`);
  const rows = parseCsv(await response.text()).filter(row => row.product_key && isTrue(row.active || 'true'));
  const grouped = new Map();
  for (const row of rows) {
    const item = grouped.get(row.product_key) || {
      id: row.product_key, category: row.category || 'Другое', name: row.name || row.product_key,
      image: row.image_url || '', description: row.description || '', options: [], popularity: Number(row.sort_order || 0)
    };
    item.options.push({ label: row.option_label || row.sku || 'Основной', available: isTrue(row.available), sku: row.sku || '' });
    const price = Number(String(row.price_byn || '0').replace(',', '.'));
    if (!item.price || price < item.price) item.price = Math.round(price * 100);
    if (!item.image && row.image_url) item.image = row.image_url;
    grouped.set(row.product_key, item);
  }
  return [...grouped.values()].map(item => ({ ...item, available: item.options.some(option => option.available) }));
}

createServer(async (request, response) => {
  if (request.url === '/api/catalog') {
    try {
      const payload = await catalog();
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ source: 'google', updatedAt: new Date().toISOString(), products: payload }));
    } catch (error) {
      response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Синхронизация временно недоступна', detail: error.message }));
    }
    return;
  }
  if (request.url !== '/') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Не найдено');
    return;
  }
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://telegram.org; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://telegram.org; connect-src 'self'"
  });
  response.end(html);
}).listen(port, '127.0.0.1', () => console.log(`VIOLET SHOP: http://127.0.0.1:${port}`));
