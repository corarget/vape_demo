const DEFAULT_SHEET_ID = "1jNoG5NTnJZbNCx7iAq3S1CcuS0J1EDc8BWeW-nzKNtk";
const DEFAULT_CATALOG_GID = "782461029";

const HEADER_ALIASES = {
  product_id: "product_key", productid: "product_key", id: "product_key",
  sku_id: "sku", variant_sku: "sku", article: "sku", артикул: "sku",
  category_name: "category", категория: "category",
  product_name: "name", title: "name", название: "name", товар: "name",
  variant: "option_label", variant_name: "option_label", option: "option_label", вкус: "option_label",
  цена: "price_byn", price: "price_byn", price_by: "price_byn",
  in_stock: "available", stock: "available", наличие: "available",
  is_active: "active", enabled: "active", активен: "active",
  image: "image_url", photo: "image_url", photo_url: "image_url", фото: "image_url",
  описание: "description", priority: "sort_order", order: "sort_order"
};

const CORE_FIELDS = new Set([
  "product_key", "sku", "category", "name", "option_label", "price_byn",
  "available", "active", "image_url", "description", "sort_order", "popularity"
]);

const PUBLIC_FIELD_LABELS = {
  brand: "Бренд", manufacturer: "Производитель", flavor: "Вкус",
  volume: "Объём", volume_ml: "Объём", strength: "Крепость",
  nicotine_strength: "Крепость", color: "Цвет", size: "Размер",
  material: "Материал", weight: "Вес", country_of_origin: "Страна производства",
  warranty: "Гарантия", tags: "Теги", badge: "Метка", is_new: "Новинка"
};

function normalizeHeader(value) {
  const normalized = String(value ?? "")
    .replace(/^\uFEFF/, "").trim().toLowerCase()
    .replace(/[\s\-./]+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "");
  return HEADER_ALIASES[normalized] || normalized;
}

function clean(value) {
  return String(value ?? "").trim();
}

function parseBoolean(value, fallback) {
  const text = clean(value).toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes", "y", "да", "есть", "в наличии", "available"].includes(text)) return true;
  if (["false", "0", "no", "n", "нет", "отсутствует", "нет в наличии", "unavailable"].includes(text)) return false;
  return fallback;
}

function parseNumber(value) {
  const text = clean(value).replace(/\s+/g, "").replace(/[^\d,.-]/g, "");
  if (!text) return null;
  let normalized = text;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
      ? normalized.replace(/\./g, "").replace(",", ".")
      : normalized.replace(/,/g, "");
  } else normalized = normalized.replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parsePriceCents(value) {
  const number = parseNumber(value);
  return number === null ? 0 : Math.round(number * 100);
}

function safeImageUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function parseCSV(text) {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"' && quoted && source[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some(value => String(value).trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }

  if (quoted) throw new Error("В CSV обнаружено незакрытое поле в кавычках");
  row.push(cell);
  if (row.some(value => String(value).trim() !== "")) rows.push(row);
  return rows;
}

function getPublicField(field) {
  let key = field;
  if (key.startsWith("public_")) key = key.slice(7);
  else if (key.startsWith("display_")) key = key.slice(8);
  else if (!Object.prototype.hasOwnProperty.call(PUBLIC_FIELD_LABELS, key)) return null;
  if (!key) return null;
  return { key, label: PUBLIC_FIELD_LABELS[key] || key.replace(/_/g, " ") };
}

export function parseCatalogCSV(csvText) {
  if (!csvText || /^\s*</.test(csvText)) {
    throw new Error("Google Sheets вернул не CSV. Проверьте доступ к таблице по ссылке");
  }

  const rows = parseCSV(csvText);
  const rawHeaders = rows.shift();
  if (!rawHeaders?.length) throw new Error("В листе Catalog нет строки заголовков");

  const headers = rawHeaders.map(normalizeHeader);
  const headerSet = new Set(headers);
  for (const required of ["product_key", "name", "price_byn"]) {
    if (!headerSet.has(required)) throw new Error("В листе Catalog отсутствует обязательный столбец: " + required);
  }

  const grouped = new Map();
  const publicFields = new Map();

  rows.forEach((values, rowIndex) => {
    const row = {};
    headers.forEach((header, columnIndex) => {
      if (header) row[header] = clean(values[columnIndex]);
    });

    const productKey = clean(row.product_key) || clean(row.sku);
    if (!productKey || !parseBoolean(row.active, true)) return;

    const price = parsePriceCents(row.price_byn);
    const sortOrder = parseNumber(row.sort_order);
    const popularity = parseNumber(row.popularity);
    let item = grouped.get(productKey);

    if (!item) {
      item = {
        id: productKey,
        productKey,
        category: clean(row.category) || "Другое",
        name: clean(row.name) || productKey,
        image: safeImageUrl(row.image_url),
        description: clean(row.description),
        price,
        priceMin: price,
        priceMax: price,
        available: false,
        popularity: popularity ?? 0,
        sortOrder: sortOrder ?? rowIndex,
        options: [],
        attributes: {}
      };
      grouped.set(productKey, item);
    } else {
      if (!item.image && row.image_url) item.image = safeImageUrl(row.image_url);
      if (!item.description && row.description) item.description = clean(row.description);
      if (sortOrder !== null) item.sortOrder = Math.min(item.sortOrder, sortOrder);
      if (popularity !== null) item.popularity = Math.max(item.popularity, popularity);
    }

    const optionAttributes = {};
    for (const [field, value] of Object.entries(row)) {
      if (!value || CORE_FIELDS.has(field)) continue;
      const publicField = getPublicField(field);
      if (!publicField) continue;
      optionAttributes[publicField.key] = value;
      if (!item.attributes[publicField.key]) item.attributes[publicField.key] = value;
      publicFields.set(publicField.key, publicField.label);
    }

    const option = {
      sku: clean(row.sku),
      label: clean(row.option_label) || clean(row.sku) || "Основной",
      available: parseBoolean(row.available, false),
      price,
      sortOrder: sortOrder ?? rowIndex,
      attributes: optionAttributes
    };
    item.options.push(option);
    item.available = item.available || option.available;
    item.priceMin = Math.min(item.priceMin, price);
    item.priceMax = Math.max(item.priceMax, price);
  });

  const products = [...grouped.values()].map(item => {
    item.options.sort((a, b) =>
      Number(b.available) - Number(a.available) ||
      a.sortOrder - b.sortOrder ||
      a.label.localeCompare(b.label, "ru")
    );
    item.price = item.priceMin;
    return item;
  });

  products.sort((a, b) =>
    Number(b.available) - Number(a.available) ||
    a.sortOrder - b.sortOrder ||
    a.name.localeCompare(b.name, "ru")
  );

  return {
    products,
    fields: [...publicFields.entries()].map(([key, label]) => ({ key, label }))
  };
}

export async function loadCatalog({
  spreadsheetId = DEFAULT_SHEET_ID,
  catalogGid = DEFAULT_CATALOG_GID
} = {}) {
  const url = "https://docs.google.com/spreadsheets/d/" +
    encodeURIComponent(spreadsheetId) +
    "/export?format=csv&gid=" + encodeURIComponent(catalogGid);

  const response = await fetch(url, {
    headers: { Accept: "text/csv,text/plain;q=0.9,*/*;q=0.1" },
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) throw new Error("Google Sheets вернул HTTP " + response.status);
  const csvText = await response.text();
  const parsed = parseCatalogCSV(csvText);

  return {
    source: "google-sheets",
    updatedAt: new Date().toISOString(),
    products: parsed.products,
    fields: parsed.fields
  };
}
