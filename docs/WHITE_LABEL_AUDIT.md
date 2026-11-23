# White-label baseline audit

Baseline: GitHub main 843a7eb360b8d023c83b679fa56dc9c49fd1d80a, audited 2026-11-23. Static inspection and targeted checks; this is not a production readiness certification.

## Architecture and observed deployment

- Storefront: index.html embedded into site.mjs. Management and courier UI: admin.html embedded into admin.mjs. worker.mjs serves the pages and API; catalog.mjs imports Google Sheets CSV; promotions.mjs implements offers; D1 stores business records and settings.
- Store deployment is violet-shop-demo, with DB binding to violet-shop-db. violet-shop-media also exists; its behavior was not independently inspected.
- Worker currently serves version b0be1219-2ae7-4b03-ac83-5beaed9b0072 (100%), created 2026-11-23 14:17:52 UTC by API upload. Its version metadata has no commit SHA, so exact source correspondence cannot be proven. It predates the 16:51 UTC merge of PR #1. The active configuration has compatibility date 2025-04-01; main specifies 2026-11-21. Do not assume main is deployed.
- Live D1 migration ledger lists 0001–0007; 0008 has not been applied. Live sqlite_master confirms slot_blocks permits all, pickup and delivery, but not metro. DB queries read metadata only.
- BOT_TOKEN binding exists; that does not verify token validity, webhook registration, messaging or end-to-end behavior. No secret values were read.

## Confirmed migration failure — high priority

An isolated empty D1 database was created for the audit. Each migration 0001–0007 succeeded when sent through D1 query API. Migration 0008 failed with error 7500: SQL BEGIN TRANSACTION or SAVEPOINT is not supported by the D1 transaction execution environment. The temporary test database was deleted afterward. This test used API calls, not Wrangler's migration runner; reproduce with the actual runner before release. No production migration was run.

0008's table rebuild also needs upgrade-data, foreign key, index and failure/rollback tests before it can safely be applied to an existing store. Do not edit migrations 0001–0007. Decide how to correct 0008 based on applied migration state across all stores, not solely this demo.

## Findings in main

P0/P1 are engineering priorities, not claims of proven exploitation.

1. P1 — No checkout idempotency key: createOrder (worker.mjs:564–695) creates a fresh UUID per request. Repeated submission can create duplicate orders and notifications. Test retries and lost responses.
2. P1 — Order state changes are vulnerable to concurrent writes: updateOrderStatus reads a status, checks transition, then updates by id without a version/status predicate (worker.mjs:709–745). version is incremented but not used for optimistic locking. Payment status has the same issue (1212–1219). Concurrent actors may overwrite each other and produce misleading events/notifications.
3. P1 — Owner bootstrap and invite consumption are not atomic with staff creation (worker.mjs:758–789): bootstrap_used or invite is consumed before staff insertion; simultaneous requests or a failed insert can consume the credential or create inconsistent outcomes.
4. P1 — Webhook duplicate handling records an update before processing (worker.mjs:894–928) and immediately skips all duplicate ids, regardless of handled flag. Failure after insertion can permanently drop the update on retry; update_id zero is also not recorded due to truthiness check. Callback permission validation is present. Requires retry-aware processing and tests.
5. P1 — Promo max-use enforcement reads a count separately from order insertion (worker.mjs:82–92, 648–681), so concurrent checkouts may exceed a limit.
6. P1 — Catalog discount calculation constructs checkout items without variantId then passes item.variantId to discountForProduct (worker.mjs:614–643). Variant-id-targeted discounts may not be applied. Verify all selectors with tests.
7. P1 — Recovery endpoint exists but new orders set recoveryCode and recoveryHash to null (worker.mjs:667–668, 696–707). New customers cannot obtain a working recovery code from checkout. History by verified Telegram ID is separately implemented.
8. P1 — No quantitative inventory reservation or decrement is present in checkout. Catalog available flag is a boolean. This does not guarantee stock availability under simultaneous purchases.
9. P1 — The order-creation notification sends to manager only, while customer messages are sent on later statuses (worker.mjs:329–357). Customer confirmation through Telegram is missing. The /orders command links to the app root without an explicit history destination (919–925).
10. P2 — Checkout calls loadCatalog directly for each order (worker.mjs:609–611). Storefront cache uses Workers Cache API and may serve stale cached data, but it is not a durable last-known-good catalog; checkout fails if Sheets cannot load.
11. P2 — Slot insertion uses a conditional INSERT with a count check in a D1 batch (worker.mjs:670–691), a stronger protection than a read-only precheck; still needs concurrent tests on D1, especially interactions with schedule/block changes. Do not classify as fully verified.
12. P2 — Monetary model still assumes price_byn in importer, and literal BYN appears in checkout, promotion errors and notifications (catalog.mjs:13, 28, 134; worker.mjs:86, 341, 647). Config currency alone is insufficient.
13. P2 — Defaults and bot messages include VIOLET SHOP (worker.mjs:21–30, 924). Jurisdiction, data residency, legal document and other required white-label fields are not established by this audit.
14. P2 — Provisioning script creates D1, applies migrations and deploys, then sets bootstrap secret. It has no rollback on failure, automated health check, store registry, bot/domain provisioning or jurisdiction choice. New store creation will encounter migration 0008 failure in the tested API execution path; Wrangler path remains to be verified. Worker deploy precedes bootstrap setup, creating an intermediate incomplete configuration.
15. P2 — Payment methods and paid/refunded labels exist; these are not a payment-provider integration or audited refund ledger. A state label does not prove money moved.
16. P2 — request body size check uses Content-Length only (worker.mjs:111–114); enforcement when header is absent or misleading needs verification. CSRF/XSS, rate limits, token logging, backup/restore and full authorization require deeper testing.
17. P2 — system uses verified Telegram init data HMAC with 24-hour validity and future skew limit; targeted negative tests have not been run. Missing BOT_TOKEN blocks checkout but returns the generic inside-Telegram message.
18. P2 — CI npm test currently runs UTF-8 validation. Workflow performs npm ci, encoding test, embedding and node syntax check, but does not check migrations, behavior, races or browser paths. Workflow for baseline main succeeded: https://github.com/corarget/vape_demo/actions/runs/45221212770.

## Feature and requirements map

| Area | Evidence/status |
| --- | --- |
| Storefront, admin, courier, order status | Implemented in code; browser and end-to-end behavior not verified |
| Telegram identity, callback permissions | Implemented in main; negative tests and live bot behavior unverified |
| Migration for metro blocks | Present in repository; failed in isolated D1 API test and absent from live DB |
| Conditional slot capacity | Present in SQL; concurrency guarantees and schedule races unverified |
| Google Sheets mapping, variant images, fuzzy search | Code/docs describe support; full behavior and source outage not tested |
| Configurable appearance, schedule, payments | Partly implemented; comprehensive white-label coverage not verified |
| Checkout idempotency, status locking, atomic invitations, quantitative stock | Missing or inadequate as detailed above |
| Provider payments, transaction/refund ledger, robust promotions | Not established; manual status fields exist |
| Automated independent store creation | Partial provisioning script; migration failure and missing recovery controls |
| Persistent test/staging environment, browser/Telegram E2E, restore and isolation tests | Not established in this audit |

## Validation and remaining work

- node --check passed for worker.mjs, catalog.mjs and promotions.mjs, from the audited commit.
- GitHub baseline Validate workflow passed; this is the limited workflow described above.
- Temporary D1 migration experiment passed 0001–0007 and failed 0008; temporary DB removed.
- The shell could not resolve github.com, so a normal checkout and npm ci could not be completed in this environment. Files were retrieved through the GitHub connector. No end-to-end browser or Telegram flow, full functional suite, exact deployment-source comparison, upgrade-data migration, staging Worker deployment, or full authorization penetration test was completed.
- Treat this report as the initial baseline, not evidence that phase 1 acceptance is complete. Finish the missing checks and establish repeatable staging tests before calling the phase complete.
