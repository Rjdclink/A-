# A+ — AI Sales, Marketing & Commerce Optimization
A consent-first, single-instance foundation for revenue measurement and evidence-grounded AI growth experiments.

## Implemented (v0.1)
- Event ingestion with explicit consent, workspace isolation, bearer token authentication, stable event IDs and duplicate suppression.
- Visits, views, carts, checkout, orders and lead aggregation with campaign breakdowns.
- Deterministic lead-intent scoring and funnel recommendations.
- Vireonix `auto` AI strategist, using **aggregated data only**, same endpoint family as GrowthVeyra.
- Read-only browser dashboard, human-reviewed advice, zero production publishing.
- No external runtime dependencies; Node 22+.

## Run
```sh
cp .env.example .env
# Generate distinct random ADMIN_TOKEN and INGEST_TOKEN (minimum 24 chars).
# Node 22+ built-in dotenv support:
node --env-file=.env src/server.mjs
```
Open http://localhost:3000, enter ADMIN_TOKEN and workspace `default`.
For a public deployment: HTTPS reverse proxy, private durable DB volume, secret management, backups, rate limits, edge request-size limits and a single application instance.

## Ingest a consented event
```sh
curl -X POST http://localhost:3000/api/events \
 -H 'Authorization: Bearer YOUR_INGEST_TOKEN' \
 -H 'Content-Type: application/json' \
 -d '{"workspace":"default","id":"checkout-12345","type":"purchase","value":89.95,"currency":"USD","campaign":"search-autumn","consent":true}'
```
**Do not put the ingest token in public browser code.** Ingest through a trusted backend or verified integration adapter. Event IDs must be stable across retries. `consent:true` is an assertion by your backend that applicable permission was secured—not a substitute for collecting consent. Ensure retention and deletion obligations are satisfied before live use.

## APIs
- `GET /health` — health check
- `POST /api/events` — ingestion token required
- `GET /api/overview?workspace=default` — admin token required
- `POST /api/score?workspace=default` — admin token required, body `{"events":["view","cart"],"email":"a@example.com"}`
- `POST /api/advice?workspace=default` — admin token required, body `{"objective":"Improve conversion"}`

## Roadmap / explicit nonclaims
Not Shopify-certified; no Shopify OAuth, GraphQL sync or verified webhook receivers; no Google Ads integration; no email sends, ad buys, audiences or automatic campaign modifications. Also missing multi-user RBAC, strong data warehouse, event deletion, instrumentation SDK, advanced attribution, experiment statistics, rate limiting and hardened production deployment. These must be implemented and independently verified before enterprise use. Metrics count *events* (not necessarily unique visitors); conversion rate is a naive ratio of purchase events to visit events, not deduplicated shopper cohorts. Revenue combines input values without FX conversion: use one currency per workspace.

## Research influences
- Shopify official webhook/privacy API requirements: https://shopify.dev/docs/apps/build/webhooks and https://shopify.dev/docs/api/customer-privacy
- Google Ads conversion consent requirements: https://developers.google.com/google-ads/api/docs/conversions/getting-started
- PostHog (funnels, attribution, experiment/feature flags): https://github.com/PostHog/posthog
- GrowthBook (experiment methodology): https://github.com/growthbook/growthbook
- Mautic (marketing automation workflows): https://github.com/mautic/mautic
- Saleor (commerce extensibility/webhooks): https://github.com/saleor/saleor

Conceptual comparisons only. No code from those projects was copied.
