# A+ Neon Production Deployment

The public A+ dashboard is served by Neon Functions in project `royal-dust-98081800`, branch `br-sweet-mode-b4p7cw35`, Function slug `aplus`.

## GitHub → Neon single source of truth

The runtime source is `functions/aplus/index.mjs`. The build command `npm run bundle:neon` combines it with the commerce engine, the Recovery engine, GrowthVeyra orchestration, and the complete dashboard and visual designer. The resulting `dist/index.mjs` is a Node.js 24 ESM Function bundle. ZIP only this file at the archive root as `index.mjs`; deploy it using the Neon Function deployment API or Neon CLI. GitHub Actions are not required.

Run `npm ci`, `npm run verify`, and `npm run bundle:neon` before deploying. Verify the HTTP routes `/`, `/health`, `/api/dashboard-config`, `/api/recovery/overview`, `/api/growth/overview`, `/api/integrations/status`, and `/studio/` on the exact public invocation URL.

## Persistent data

Neon PostgreSQL stores the existing A+ commerce and GrowthVeyra SQLite snapshots in the `aplus_function_state` table. A PostgreSQL transaction serializes updates per workspace. Before the snapshots are persisted, SQLite WAL files are checkpointed. Do not reset this table, rotate the pseudonym key, or overwrite its bytes during a deployment. Also store limited operational activity in `aplus_integration_events`.

This snapshot architecture favors durable, serialized correctness over high request throughput. Evaluate a direct Postgres migration and load-test before scaling concurrent or high-volume usage.

## Unattended operation

Neon scheduled triggers call `POST /tasks` with a verified Neon-generated invocation header. The adapter rejects unsanctioned calls; Neon strips caller-supplied `X-Neon-*` headers from normal requests. Configure a scheduled trigger (UTC cron) on the A+ Function after deployment, for example every 15 minutes, to progress explicitly enabled automations and website rechecks without depending on web visitors. Check Neon logs for actual successful invocations.

## External connectors

`Advanced Controls → External connections` reports credential configuration and actual Neon connection status, without exposing secrets. This is not proof that an external email provider, AI model, Square merchant account, or Shopify shop is connected; test those with provider-approved credentials and real upstream responses. Catalog entries are setup profiles, not live connections.

The dashboard intentionally opens by URL with no visitor login because that was requested for buyer review. That makes every authorized public admin endpoint usable by anyone who obtains the URL. A hard-to-guess URL is not an authorization control.
