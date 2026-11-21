# VIOLET SHOP

White-label движок магазина: Telegram Mini App-витрина, операционная панель и клиентская конфигурация. Текущий production-магазин использует BYN и Europe/Minsk; новые копии настраиваются отдельно.

## Production

- Mini App: https://violet-shop-demo.platondran.workers.dev/
- Manager panel: https://violet-shop-demo.platondran.workers.dev/admin
- Courier panel: https://violet-shop-demo.platondran.workers.dev/courier
- Health: https://violet-shop-demo.platondran.workers.dev/api/health

## Architecture

- `index.html` / `site.mjs` — покупательская витрина.
- `admin.html` / `admin.mjs` — менеджерский пульт и интерфейс курьера.
- `catalog.mjs` — CSV import, normalization and product-family grouping.
- `worker.mjs` — API, auth, order lifecycle, slot booking, Telegram webhook.
- Cloudflare D1 (`violet-shop-db`) — orders, order items, staff, sessions, schedule, logs and settings.
- Google Sheets — source of truth for product catalog only.

## Google Sheets catalog

Источник Google Sheets задаётся в `/admin → Каталог и синхронизация`. Для новой копии нет привязки к таблице предыдущего магазина: менеджер подключает свою таблицу, выбирает GID листа, проверяет заголовки и настраивает сопоставление столбцов.

Importer maps columns by header name and supports a saved CSV template plus manual field mapping. The canonical columns include `product_key` or `sku` (unique variant ID), `category`, `category_label`, `category_image_url`, `category_icon`, `name`, `option_label`, `price_byn`, `image_url`, `available`, `active`, `manufacturer`, `strength_mg`, `resistance_ohm`, `component_type`, and `color`. Category label, image and icon columns are optional; when present, their values are synchronized into category settings.

### Product families and variants

Use one row per sellable variant. Grouping by the unique variant ID would leave every flavour in a separate card, so product families are formed from category, manufacturer, product-line name and component type.

A storefront card is grouped by:
- category;
- manufacturer / brand;
- product-line name;
- component type (when present).

Rows in the same family become selectable variants. Variant attributes such as flavour, strength, resistance and colour remain attached to the variant. If one line has multiple strengths, strength is appended to the option label. Internal `product_key` and `sku` are retained for order records and manager views but are not rendered in the customer UI.

This keeps flavour variants together while preserving distinct product lines and component types.

New public attributes can be added using known field names or a `public_` / `display_` prefix. Unknown unprefixed columns are not exposed to the customer API.

## Customer flow

1. Browse families, search, filter by category and brand, sort by analytics / brand / price / name.
2. Choose a flavour/variant. Unavailable variants are visually de-emphasized; selecting one explains that it is temporarily unavailable and does not add it to the cart.
3. Add variants to the cart.
4. Enter name and phone, choose pickup or delivery, date and available time slot.
5. The Worker rechecks availability and price against the current sheet before creating an order.
6. Order history is fetched from D1 using a private random customer token stored in the browser.

## Order workflow

- `new` → `confirmed` / `rejected` / `cancelled`
- `confirmed` → `preparing`
- `preparing` → `ready`
- Pickup: `ready` → `completed`
- Delivery: `ready` → `assigned` → `picked_up` → `on_the_way` → `delivered` → `completed`

Managers confirm/reject orders, move them through preparation, assign or reassign couriers, update payment status and inspect event history. Couriers see only their assigned jobs and can update pickup / en-route / delivered states. Customers see status and event updates in their order history.

## Manager and courier access

Open `/admin` or `/courier`.

The first login uses a one-time owner bootstrap code provided separately at deployment. Enter the code and the owner's display name. The code is stored only as a SHA-256 hash in D1 and is invalidated after the first successful owner login.

Managers create one-time staff invitations from the Team section. Invitations expire after 48 hours and can create manager or courier accounts. A Telegram ID can be attached to an invitation or edited in the Team section for bot notifications.

Staff sessions use random, hashed server-side session identifiers in HttpOnly, Secure, SameSite cookies. Customer routes never expose manager functions.

## Schedule and slots

- Weekly opening/closing times for each weekday.
- Slot duration, lead time, booking horizon and capacity.
- Pickup and delivery can be enabled independently.
- Managers can block full days or selected time ranges for pickup, delivery or both.
- The Worker checks capacity again during order insertion, so two buyers cannot successfully reserve the final slot simultaneously.

Initial schedule values are placeholders (10:00–21:00 daily, 60-minute slots, 60-minute lead, 4 orders per slot). Set the real store schedule in `/admin → Слоты и график`.

## Analytics

The storefront records anonymous events: product views, add-to-cart actions, unavailable-variant clicks, category/brand filters, searches, checkout starts and completed order items. Visitor tokens are hashed before storage; email-like and phone-like search strings are discarded. Managers can inspect 7/30/90-day totals, top products, search terms and daily activity from `/admin → Аналитика`.

The 30-day product score is calculated as views + 4 × cart additions + 12 × ordered items. It is exposed to the storefront as an analytics sorting signal and can be selected as the default sort strategy.

## White-label configuration

The admin can change the store name, tagline, logo URL, hero copy, theme colors and default sorting without editing source code. Category keys continue to come from the source sheet; managers can customize each category's public label, image URL, icon, visibility and order.

A CSV template can be attached to the catalog setup. The original file is stored with the template metadata in D1; headers and column mappings are reusable. The admin can preview live Google Sheets headers, map them to canonical fields, and download the attached template.

Use `/admin → Брендинг и копирование` to export or import a configuration JSON. The transfer file includes store presentation, category overrides and catalog-template metadata. It excludes the source spreadsheet ID, orders, staff accounts, sessions, customer tokens and bot secrets. Connect the new client's own sheet after importing.

For each customer, deploy a separate Worker and D1 database. Give the client's operator access by creating a one-time manager invitation in `/admin → Команда`. Do not share the developer's Cloudflare or GitHub credentials.

See [docs/WHITE_LABEL_SETUP.md](docs/WHITE_LABEL_SETUP.md) for the repeatable client handoff procedure.

## Sync, logs and diagnostics

- Public catalog is cached for 45 seconds.
- Manager can force a sync from `/admin → Каталог и синхронизация`.
- Every sync creates a D1 run record with row, family and variant counts.
- API, auth, Telegram and catalog errors are written to `system_logs`.
- `GET /api/health` checks Worker and D1 availability.

## Telegram integration

The code supports:
- manager notification on new orders;
- confirm / reject callback buttons;
- customer status notifications (when the customer opened the bot and Telegram initData is verified);
- courier assignment notifications;
- webhook callback handling.

To activate it:
1. Add the bot token as a Cloudflare Worker secret named `BOT_TOKEN` (never commit it).
2. Open `/admin → Telegram`, enter the manager chat ID and save.
3. Press “Настроить webhook”.
4. Add Telegram IDs for managers and couriers in the Team section.

Without `BOT_TOKEN`, orders and manager/courier workflows still work in the Mini App panels, but bot notifications and Telegram callback actions remain inactive.

## Cloudflare D1

Database: `violet-shop-db`  
Database ID: `a8aaafe7-93ff-43f0-892e-3c22d1d37ad5`  
Jurisdiction: EU; primary region: Eastern Europe.

Schema sources: `migrations/0001_init.sql` and `migrations/0002_analytics.sql`.

## Development and deployment

Requires Node.js and Wrangler.

```bash
npm install
npm run dev
npm run deploy
```

Do not commit Cloudflare API tokens, bot tokens, owner bootstrap codes or customer session tokens.
