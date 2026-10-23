# GrowthVeyra AI — Enterprise Automation Platform

GrowthVeyra AI is an independently implemented, deployable workflow and AI-agent orchestration platform. It is inspired by publicly described enterprise AI SaaS capabilities; it does **not** contain the proprietary code of any company offered for sale.

## Implemented features

- Single-administrator workspaces, scrypt authentication, hashed sessions, isolated customer records and a concise dashboard; no shared users or role permissions.
- Validated directed acyclic workflows, conditional branches, text templating, source-grounded knowledge search, AI reasoning steps, approval gates and public HTTPS GET/POST actions.
- Autonomous recurring schedule and secret-authenticated webhooks, persistent execution checkpoints, retries, recovery after process restart, cancellations, execution logs and audit trails.
- Compatibility with the **same Vireonix `auto` chat-completions endpoint** used by AI Revenue Recovery, with optional separately credentialed provider failover for rate limits, provider outages and invalid responses.
- Persisted acknowledgments for successful outbound POST actions allow retries after local checkpoint failures without repeating previously acknowledged calls.
- One-time webhook secrets, outbound integration allowlists, public-address DNS filtering and default approval for external POST actions.
- Starter templates and a minimal responsive dashboard with an interactive graph editor, contextual step controls, hidden advanced configuration, safe previews and optional AI-assisted workflow drafts.
- Durable parent/child automation execution with bounded recursion, cancellation propagation and restart-resumable results.
- Immutable execution definitions, atomic schedule-to-queue handoff, tenant-isolated FTS5 knowledge indexing and guarded failed-run retries.
- Per-run model-call budgets and provider-reported token accounting without inventing missing usage figures.
- Optimistic revision checks protect workflow editing across browser tabs.
- Immutable tenant-isolated workflow revision history with rollback; portable JSON workflow export and import that starts paused, strips connection identifiers and regenerates webhook secrets.
- Seven-day real outcome metrics for completed/failed runs and an on-demand diagnostics view under Activity.
- Built-in online SQLite backup command with integrity checking and bounded retention; validated recovery snapshots.
- Zero package dependencies; Node.js >=22.16 with built-in SQLite. Supports one persistent worker instance; provision a mounted volume for production data.

## Running locally

```bash
cp .env.example .env    # example only; Node does not automatically load .env
# choose one option:
ALLOW_SIGNUP=true SESSION_COOKIE_SECURE=false node src/server.mjs
# or Node 22+ built-in env-file loading:
node --env-file=.env src/server.mjs
```

Visit http://localhost:3000 and create the first workspace. Set `ALLOW_SIGNUP=false` after initial provisioning if public signups are not desired.

```bash
npm test
npm run verify  # syntax + full tests + HTTP/workflow smoke check
npm run backup   # online integrity-checked SQLite snapshot
```

No live outbound communication or paid billing is enabled by default. The application is operational without API credentials for template, knowledge, scheduling, and human-approved workflows. AI tasks require an available provider. Vireonix imposes shared rate limits and provides no guaranteed service level. If `AI_FALLBACK_BASE_URL` is configured, prompts can be sent to that alternative provider when the primary fails; the alternative uses only `AI_FALLBACK_API_KEY`, never the primary key. An authentication rejection (HTTP 401/403) does not trigger fallback.

## Deployment (Railway, VM, container)

1. Use **Node.js 22.16 or later** and start with `npm start`.
2. Attach a persistent disk/volume, e.g. `/data`, and set `DB_PATH=/data/growthveyra.sqlite`. Without a volume, restarts may erase all accounts and execution history.
3. Configure `PORT`, `ALLOW_SIGNUP`, `SESSION_COOKIE_SECURE=true` (requires HTTPS), and AI variables from `.env.example`.
4. Run exactly **one worker replica** with SQLite. Use a dedicated PostgreSQL-backed queue before operating multiple replicas at enterprise scale.
5. Confirm `/api/health`, register a workspace through the browser, create a template workflow, execute it, restart the application, and confirm history persists.
6. For unattended integration actions, add exact external hostnames in `spec.allowed_hosts` and opt in to `allow_external`. By default HTTP POST actions request approval even when the workflow itself runs automatically.
7. Monitor errors, backups, scheduler uptime, outbound service permissions, rate limits and data retention in the production environment.

**Do not claim enterprise availability, 45:1 inference efficiency, independent security certification, financial performance, live customer counts, unlimited AI capacity or 100% autonomous task success without separately verifying them.** This repository contains an independently tested operational core, not those representations.

## Safe previews and AI-assisted workflow creation

Inside an automation's **Design** editor, choose **Preview** to simulate text, branch, end, and local knowledge steps with test input before saving. The simulator stops before AI calls, approvals, sub-workflows, and network actions. An unsaved graph can be previewed; no run is queued and no tokens are consumed.

Inside **New automation**, expand **Create from a description** to ask a configured AI provider for a reviewable draft. The response is schema-validated, limited to non-external step types, never creates or activates a workflow automatically, and is quota-limited per workspace (`MAX_BLUEPRINTS_PER_HOUR`). When the operator saves this generated draft, it starts **paused**. AI model uptime and output quality depend on the configured provider.

## Execution durability and safe recovery

Each queued execution stores its own immutable workflow definition; edits affect new runs, not already-queued ones. A queue update and scheduled trigger advance atomically. Failed runs can be manually retried up to three times while preserving checkpoints and action receipts. Outbound permission changes cannot grant newly elevated permissions to already queued work, and revoked permission immediately requires approval.

A `subworkflow` step can invoke an enabled automation in the same workspace, wait for its result, resume after a restart, and cancel outstanding descendants. Nesting is bounded to prevent runaway recursion. The visual editor exposes **Call automation**, with reusable input mapping and a linked activity history.

`MAX_AI_CALLS_PER_RUN` (default 24) caps actual model invocations per run, including specialist agents and retries. The private usage ledger records provider-reported token counts when present; missing counts remain unknown rather than estimated.

## Visual workflow editing and version history

Open **Automations → Design** on any automation. Select nodes to edit their prompts, decisions, connections and next steps; add a step to a path; then save. **Versions** lists immutable snapshots and restores older definitions while preserving the existing webhook secret. Restoring and changing graphs are blocked while jobs are active. Advanced JSON is optional, not required.

**Export** downloads a workflow definition without encrypted credentials or saved connection IDs. The **Import file** action in the New automation panel creates a fresh, **paused** copy with newly issued webhook secrets. Reconnect integrations and review host allowlists before enabling it. Literal secrets embedded in template text are not automatically redacted: never store credentials in prompts or URLs.

## Backups and handover

Set `DB_PATH` to a persistent SQLite file. Configure `AUTO_BACKUP_HOURS=24` for unattended, in-process SQLite snapshots (set 0 to disable). The first backup runs at the first worker cycle after enablement; timestamps and retries persist across restarts. Failed backups retry after five minutes, and the administrator can read `GET /api/maintenance` for a concise backup status. `BACKUP_DIR` defaults to `data/backups`; `BACKUP_RETAIN` defaults to 7 and supports 1–90 snapshots. `npm run backup` is also available for manual backups. **Copy encrypted backups to an independent, off-host location.** Local scheduled snapshots do not protect against volume failure, and backups cannot run while the worker is offline.

A restore requires stopping the service, securely copying a tested snapshot to the configured DB path, checking file ownership, and restarting. Test restoration against a staging instance before risking production data. Secrets encrypted with `INTEGRATION_MASTER_KEY` cannot be recovered without the original key.

## Reproducible deployment

`Dockerfile` and `compose.yaml` provide a single-replica, persistent-volume deployment example. For local Docker Compose testing, set `ALLOW_SIGNUP=true` only during initial provisioning and `SESSION_COOKIE_SECURE=false` only for localhost HTTP. For internet access, use an HTTPS reverse proxy, `SESSION_COOKIE_SECURE=true`, allow trusted origins, close public signups, and configure durable monitoring and offsite backups.

Use `npm run verify` for a complete local, server-based validation: syntax checks, regression tests, and an isolated HTTP/workflow smoke test. No hosted CI service is required or configured. Local verification cannot prove live provider availability, production uptime, actual customers, or distributed-scale throughput.

## App catalog and native recurring subscriptions

The dashboard now includes **Apps** and **Subscription** as separate, concise views; the Overview still displays only three essential numbers. Apps provides **95 preconfigured integration setup profiles** with accurate vendor categories, API host restrictions, encrypted token storage and read-only verification when supported. Profiles are not pre-authorized connections: each buyer must obtain valid credentials and provider permissions. Broad OAuth auto-onboarding and a guaranteed tested 95-app connector marketplace are not included.

The native Square subscription backend creates a Square-hosted recurring checkout for **server-configured plan variations**, verifies signed subscription webhooks, links a subscription to its initiating Square order reference, deduplicates events and supports owner-initiated cancellation. It does **not** collect or retain credit-card numbers. Each variation ID and matching price must be configured in \`.env\`; Square must have a corresponding plan/variation and webhook subscription.

Set \`SQUARE_ENVIRONMENT\` explicitly (\`sandbox\` or \`production\`), \`SQUARE_ACCESS_TOKEN\`, \`SQUARE_LOCATION_ID\`, \`SQUARE_WEBHOOK_URL\` (the **exact** external HTTPS URL registered with Square) and \`SQUARE_WEBHOOK_SIGNATURE_KEY\`. Subscribe Square to \`subscription.created\` and \`subscription.updated\`; allow outbound calls to Square's Subscriptions and Orders APIs. The Square Checkout API can create a **new Square customer at checkout**, so the application maps new subscriptions to the checkout order template/reference rather than assuming a precreated customer ID. An unlinked subscription remains unentitled until positively matched.

\`BILLING_ENFORCE=true\` optionally enforces configured plan limits and paid outbound execution capabilities. Its default is \`false\` to avoid unexpectedly restricting an existing deployment. Pending checkout never grants paid access; only Square-verified active or scheduled-for-cancellation states can. Integration credentials are encrypted only when \`INTEGRATION_MASTER_KEY\` is set.

**Verification:** local tests use injected Square responses and a simulated signed webhook. No actual merchant account, live payment, real subscription, or production recurring revenue has been verified.

## External action delivery guarantees

Every successful HTTP POST result is recorded locally before the workflow checkpoint. A retry can reuse this receipt if the checkpoint write fails. The same execution/step also sends an `idempotency-key` header. **This is not unconditional exactly-once delivery:** a process crash or network interruption after the recipient executes a request but before the local receipt is stored can repeat the request. Configure receivers to honor idempotency keys and reconcile uncertain outcomes.

## Workflow JSON

```json
{
  "allowed_hosts": ["api.example.com"],
  "start": "summarize",
  "steps": [
    {"id": "summarize", "type": "ai", "system": "Summarize faithfully.", "prompt": "{{input.message}}", "next": "review"},
    {"id": "review", "type": "approval", "message": "Accept this summary: {{steps.summarize}}?", "next": "done"},
    {"id": "done", "type": "end"}
  ]
}
```

Supported types: `template` (`template`), `ai` (`system`,`prompt`), `branch` (`condition:{path,operator,value}`, `yes`,`no`), `knowledge` (`query`), `approval` (`message`), `http_get` (`url`), `http_post` (`url`, `body_template`, optional `requires_approval:false`), `end`.

Context keys in templates: `input.*`, `steps.<id>`, `approvals.<id>`. All step IDs and branches are validated before storage; cycles and unreachable nodes are rejected. HTTP actions require exact HTTPS host allowlisting; redirects, internal IPs and large responses are rejected.

## API guide

- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`; `GET /api/me`
- `GET /api/overview`, `/api/insights`, `/api/templates`, `/api/audit`
- `GET|POST /api/workflows`, `GET|PATCH|DELETE /api/workflows/:id`, `POST /api/workflows/:id/run`
- `POST /api/workflows/:id/preview` (read-only, accepts an optional unsaved spec)
- `POST /api/blueprints` (quota-limited, review-only AI draft generator)
- `POST /api/runs/:id/retry` (bounded failed-run recovery)
- `GET /api/workflows/:id/revisions`, `GET /api/workflows/:id/revisions/:revision`, `POST /api/workflows/:id/revisions/:revision/restore`
- `GET /api/workflows/:id/export`, `POST /api/workflows/import` (imports disabled by default)
- `GET /api/runs`, `GET /api/runs/:id`, `POST /api/runs/:id/cancel`
- `GET /api/approvals`, `POST /api/approvals/:id/approve|reject`
- `GET|POST /api/knowledge`, `DELETE /api/knowledge/:id`
- `POST /api/hooks/:workflowId` with `x-growthveyra-secret` header; secret displayed only when workflow is created.

All non-hook API endpoints except registration, login and health require a secure same-site session cookie or Bearer session token. Use HTTPS in production.

## Source evidence and roadmap

See [docs/RESEARCH.md](docs/RESEARCH.md) for the public-source review, architectural comparisons, confirmed implementation and outstanding enterprise-scale work. Tests are in `test/`.

## Administrator model

Each workspace uses a single owner account. Team invitations, membership administration and tiered user permissions are intentionally excluded. Separate workspace owners have isolated data. Encrypted API connections require `INTEGRATION_MASTER_KEY` to be configured on the server.

### Technical review notes

The architecture remains a **single SQLite-backed application worker**, not a distributed Temporal-equivalent system. It uses Node.js 22.16+ built-in SQLite/FTS5; deploy behind HTTPS with a persistent volume and independent offsite backups. This code does not demonstrate 100% uptime, customer revenue, or a guaranteed sale valuation. See [operations](docs/OPERATIONS.md), [research](docs/RESEARCH.md), and [architecture](docs/ARCHITECTURE.md).
