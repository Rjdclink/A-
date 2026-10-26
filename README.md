# A+ — AI Commerce Intelligence

A minimal, privacy-conscious foundation for e-commerce conversion measurement, revenue attribution, controlled A/B experiments, and human-reviewed AI optimization plans.

**Platform status: engineering prototype, not independently audited, Shopify-approved, or enterprise-certified.**

## At a glance (v0.3)
- **Minimal interface:** three signals (USD revenue, orders and event-based conversion), one next action, details revealed on request; no advertising clutter.
- **Durable data:** built-in Node.js SQLite, WAL, indexed 7/30/90-day aggregate queries, exact USD cents, transactionally deduplicated events, configurable retention and a durable 500K-event guardrail.
- **Workspace boundaries:** separate admin and ingestion tokens per tenant; shared global legacy tokens only have access to the \`default\` workspace. Access tokens are not stored in browser localStorage.
- **Experiments:** stable HMAC-based A/B assignment with consented exposure, deduplicated purchasing subjects and 14-day attribution; exploratory rate comparison returns "insufficient data" when too small.
- **Privacy:** HMAC pseudonymous subject keys, deletion/export APIs, customer-redaction tombstones that prevent re-imports, workspace removal, and a queue for merchant data-access requests.
- **Shopify webhook receiver:** signed raw-body HMAC checks, shop allowlists, paid-order idempotency, mandatory-topic handlers, persistent uninstall tombstones. **No Shopify OAuth, customer privacy approval, installed app subscriptions, or completed merchant export delivery workflow yet.**
- **Same AI as GrowthVeyra:** Vireonix \`auto\` chat-completions endpoint, only aggregate commerce metrics passed to the model; AI proposals are advisory and never send marketing or purchase ads autonomously.
- **Testing:** direct Node test suite, HTTP integration tests and migration tests. Run npm run verify locally; GitHub Actions is not configured or required.

## Growth Agent (integrated, guarded execution)

The overview dashboard includes a workspace-scoped Growth Agent that ranks evidence-based sales, marketing, analytics, and retention opportunities from recorded commerce events and campaign economics. It stores its objective, 7/30/90-day reporting window, and run history. The agent can process the existing recovery queue only when explicitly enabled; the recovery engine continues to enforce its own sequence policy, channel consent, holdouts, purchase/reply/opt-out stops, and provider delivery safeguards.

- API: `GET/POST /api/growth-agent/settings`, `GET /api/growth-agent/plan`, `POST /api/growth-agent/run`, and `GET /api/growth-agent/runs`.
- Recommendations distinguish observed signals from hypotheses and do not claim causality or guaranteed revenue.
- This is a guarded first step, not unrestricted autonomous marketing: ad-budget changes, live price changes, campaign publication, and unapproved customer messaging are not performed by the Growth Agent. Those require specific provider integrations, merchant authorization, and explicit execution policies.
- Tests: `test/growth-agent.test.mjs`; syntax verification includes `src/growth-agent.mjs`.

## Customer Service Hub (integrated, self-hosted capabilities)

A+ now contains a separate customer-service system: merchant-branded website chat, a multilingual interface with English/Spanish/French greetings, verified FAQs with atomic JSON/CSV import, individual staff accounts and access roles, a searchable ticket inbox, explicit human handoffs, internal notes, saved replies, automatic local staff routing, in-app alerts, service-level tracking, customer satisfaction trends, opt-in leads, customer and agent attachments, and ticket-level self-service export and erasure.

The module also manages staff-reviewed appointment requests and capacity-controlled **internal A+ appointment reservations and cancellations**. These do not interact with external calendars.

- Merchant console: /support-admin; the owner signs in with their workspace admin token and can create individual staff accounts.
- Visitor chat: /support?workspace=default; ticket credentials can restore a conversation within the same browser tab.
- Default customer answers use merchant-approved knowledge only. Optional AI paraphrasing requires a configured provider and both merchant and visitor opt-in.
- Local tests: npm run verify. GitHub Actions are not used.
- Outside providers **not connected**: actual email/SMS/social/telephone messaging, merchant account authentication and Shopify order actions, outside CRM/calendar updates, hosted deployment and support-specific subscription collection.

See [Customer Service Hub capabilities, setup and limits](docs/CUSTOMER_SUPPORT.md).

## Local setup

Requires Node.js **22.16+** (the built-in \`node:sqlite\` module in Node 22 remains experimental).

\`\`\`sh
cp .env.example .env
# Set ADMIN_TOKEN and INGEST_TOKEN to DIFFERENT random values of 24+ characters.
# Set PSEUDONYM_KEY to a THIRD stable secret of 24+ characters.
node --env-file=.env src/server.mjs
# Visit http://127.0.0.1:3000
\`\`\`

Avoid using literal placeholder secrets in any live deployment. Production exposure requires explicit \`HOST=0.0.0.0\` behind an HTTPS reverse proxy, secure secret management, durable mounted storage, off-host backup/restore testing and external rate limits. The application intentionally binds localhost by default.

\`\`\`sh
npm run check
npm test
\`\`\`

### Upgrading existing JSON data (v0.1/v0.2)

**Do not point \`DB_PATH\` at the old \`data/events.json\` file.** Take a verified backup, stop the old application and retain its original JSON file. With new \`DB_PATH=data/a-plus.sqlite\` and stable \`PSEUDONYM_KEY\`:

\`\`\`sh
OLD_DB_PATH=data/events.json node --env-file=.env scripts/migrate-json.mjs
\`\`\`

The migration is idempotent and preserves the original file, but it does not substitute for backup verification. An interruption can leave a partially imported SQLite DB; rerun the same command. SQLite WAL uses companion files while active—use the SQLite backup API or stop the application before making consistent filesystem snapshots.

## API essentials

Ingest only from a trusted server, not a browser with an embedded ingestion token. \`consent:true\` means your backend attests that it obtained the requisite analytics permission; it is **not a consent mechanism by itself**.

\`\`\`sh
curl -X POST http://127.0.0.1:3000/api/events \
 -H "Authorization: Bearer YOUR_INGEST_TOKEN" -H "Content-Type: application/json" \
 -d '{"workspace":"default","id":"order_123","type":"purchase","value":32.50,"currency":"USD","consent":true,"campaign":"search","customerId":"opaque-subject-id"}'
\`\`\`

- \`GET /api/overview?workspace=default&days=30\` (admin; 7/30/90 supported)
- \`POST /api/score?workspace=default\` (admin; declared behavioral lead score)
- \`POST /api/advice?workspace=default\` (admin; Vireonix AI)
- \`POST /api/experiments?workspace=default\` with \`{"id":"checkout_v1"}\` (admin)
- \`POST /api/experiments/checkout_v1/assign?workspace=default\` with \`{"subjectId":"opaque-subject-id","consent":true}\` (ingestion token)
- \`GET /api/experiments/checkout_v1?workspace=default\` (admin; 14-day purchase outcome)
- \`POST /api/privacy/export?workspace=default\` with \`{"subjectId":"opaque-subject-id"}\` (admin)
- \`POST /api/privacy/erase?workspace=default\` with \`{"subjectId":"opaque-subject-id"}\` (admin)
- \`GET /api/privacy/requests?workspace=default\` (admin)

The same stable subject identifier must be supplied to experiment assignments and later purchase events, with permission, for attribution to work. The experiment report is exploratory, unadjusted for repeated looks, and **does not establish a causal winner** without pre-registered hypotheses, guardrails and adequate power. Events, not unique shoppers, are used for the dashboard's conversion rate; this is explicitly labeled in the UI.

## Shopify receiver: opt-in only

\`SHOPIFY_SECRET\` is the app shared secret. \`SHOPIFY_SHOPS_JSON\` maps each allowlisted \`store.myshopify.com\` domain to a **dedicated** A+ workspace, e.g. \`{"store.myshopify.com":"default"}\`. No store may share the same workspace. Use \`POST /webhooks/shopify\` for signed deliveries. The optional order import remains **disabled** until \`SHOPIFY_ANALYTICS_BASIS_ACKNOWLEDGED=true\`, which the merchant should set only after documenting lawful processing and privacy notices. Default safe mode acknowledges eligible deliveries without importing orders.

Compliance topics \`customers/data_request\`, \`customers/redact\` and \`shop/redact\` have handlers. Data requests are queued for merchant follow-up—**they are not automatically fulfilled**. A signed \`shop/redact\` or \`app/uninstalled\` erases the mapped workspace and blocks further order import for that shop (until a deliberate reinstall/reset workflow is built). No Shopify public-app or privacy-law compliance claim is made.

## Constraints and valuation

Single SQLite writer, operational security review outstanding, absent billing/OAuth/automated deployment, incomplete Shopify app installation, no marketing API integrations or customer adoption evidence. Test results cannot prove production uptime, scalability or Shopify certification. See [engineering research](docs/RESEARCH.md) for the external references and gaps.

No responsible assessment can claim a greater-than-85% probability of a **$250,000+ code-only sale price** on repository contents alone; that needs independent software due diligence and comparable buyer evidence.

## Verified offline recovery workflow

`npm run backup` creates a consistent SQLite snapshot using Node's backup API, checks `PRAGMA integrity_check`, marks the file 0600, and removes backups older than the configured count. Set `BACKUP_DIR` and `BACKUP_RETAIN` (1–90). Copy completed snapshots to **independent off-host storage** and practice restoring to staging. Live backups are not automatically scheduled; make a secure operational schedule.

A merchant's `customers/data_request` remains **pending** until the operator exports the relevant records, delivers them to the merchant through an independently secure channel, and calls `POST /api/privacy/requests/complete` with `{"requestId":"request:77","deliveryConfirmed":true}` (admin token). A+ does not claim to send the export itself. Pending requests are not removed by normal retention cleanup.


## Paid campaign measurement (optional)

Supply authorized daily spend totals with `POST /api/campaigns/spend?workspace=default` using the workspace **admin** token:

```json
{"campaign":"search","date":"2026-10-22","spend":25.00,"clicks":50,"impressions":1000}
```

Repeated uploads with the same workspace, campaign and UTC date **replace**, rather than double-count, the daily spend. The overview's expandable campaign details include indicative attributed ROAS, CPA and CTR when measured. ROAS remains `null` if spend is missing. Reporting windows use UTC calendar days and do not account for refunds, cross-channel attribution, campaign spend import latency or causal incrementality. Never present these figures as verified profit or return on investment.

Shopify customer redaction also honors `orders_to_redact` for guest purchases, keeping hashed/order tombstones so replayed paid-order deliveries cannot restore erased records.
