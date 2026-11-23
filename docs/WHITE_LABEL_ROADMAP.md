# White-label roadmap

Baseline: main at 843a7eb360b8d023c83b679fa56dc9c49fd1d80a, 2026-11-23.

## Baseline and open questions

The existing application uses one Worker and one D1 database per store; Google Sheets is the catalog source. The repository contains storefront and admin HTML embedded into modules, a Worker, catalog and promotion modules, migrations 0001–0008, and a provisioning script.

PR #1 is merged: it reports UTF-8 remediation, migration 0008, Telegram hardening and basic CI. This is not evidence that the complete critical-fixes phase or an end-to-end test is complete.

Cloudflare has a violet-shop-demo Worker, violet-shop-media Worker and violet-shop-db database. Deployed revision and applied D1 migration state have not been verified. Do not assume merging main deploys this Worker.

CI currently checks encoding, generates modules and checks Worker syntax; npm test runs the encoding check only. It does not establish functional, concurrent, migration or integration correctness.

Migration 0008 contains explicit BEGIN and COMMIT. D1 runs queries within implicit transactions; this may prevent the migration from applying. Confirm on an isolated local or staging D1 before choosing a compatible fix. Do not run experiments on production data. See https://developers.cloudflare.com/d1/sql-api/foreign-keys/ and https://developers.cloudflare.com/d1/best-practices/import-export-data/.

## Stages

1. Complete baseline audit: inspect worker, schema, actual deployment and migration state without exposing secrets or customer data. Map each requirement to implemented, unverified or missing. Establish isolated staging and repeatable tests.
2. Critical correctness: safely test migration 0008, Telegram identity and webhook handling; add checkout idempotency, concurrency protection for slots, owner/invitations and status updates. Cover failure paths and verify no duplicate effects.
3. Store configuration: unify settings and expose branding, locale, contacts, delivery, legal fields and Telegram configuration with correct permission boundaries; keep secrets server-side.
4. Catalog and customer experience: cached Sheets import and mapping, variants, currency, timezone, stock modes, customer history and transparent recommendations. Preserve search behavior.
5. Payments and promotions: manual payment states, auditable transaction and refund records, provider interface, atomic limits and correct variant discounts. Do not imply an external provider exists.
6. Provisioning and releases: isolated stores, preflight, migrations, secret setup, health checks, version tracking, rollback and controlled rollout. Verify region capabilities before promising them.
7. Security and operations: authorization, session and input checks, rate limiting, backups and recovery, monitoring, data retention, CI and documentation.
8. Final staging acceptance: clean and upgrade migrations, isolation, full customer/staff/courier and Telegram paths, restore and rollout checks. Record remaining gaps.

Each stage requires tests appropriate to its changes and an explicit status. Separate preview/staging resources from live customer resources. Do not modify live D1 or run destructive migrations without explicit authorization.
