# A+ Customer Service Hub — implementation status

The A+ support hub is a **prototype feature** added to the existing commerce-intelligence application. It does not turn A+ into a certified helpdesk, deploy integrations, or imply regulatory approval.

## Capability comparison

| Capability | State | Implementation |
| --- | --- | --- |
| Website support chat | Implemented (same-origin hosted page) | \`GET /support?workspace=default\`, customer UI |
| Persistent customer conversations | Implemented | Workspace-isolated SQLite tickets and messages |
| Business-approved knowledge | Implemented | Create, edit, deactivate or delete articles; locale-specific lookup |
| Instant automated answers | Implemented for matching approved FAQ questions | Deterministic retrieval by default; never invent order details |
| AI-generated phrasing | Optional opt-in | Existing Vireonix-compatible endpoint, approved FAQ context only; merchant + customer consent gates |
| Human handoff | Implemented as ticket queue | Unmatched inquiries become \`pending\` for human review; no guaranteed notification |
| Agent inbox and replies | Implemented (in-app only) | \`GET /support-admin\`, scoped tickets/replies |
| Ticket status/priority/assignment | Implemented | Admin API & console |
| Tenant workspace boundaries | Implemented for these routes | Admin bearer authorization, hashed customer session secrets |
| Customer histories | Implemented per ticket | Customer must provide ticket ID and random session token |
| Service analytics | Basic implementation | Count by status, count of automated answers, average first agent response (when available) |
| Business branding & hours | Basic implementation | Admin settings + hosted customer page |
| Multilingual content | Basic locale selection | Merchant must supply knowledge in that locale; translation is **not** automatic |
| Data export, erasure & retention | Implemented for support records | Admin email-based tools, scoped workspace erasure, 30–730-day retention configuration |
| Lead capture | Existing A+ recovery component | Does not automatically create a lead from support messages |
| Commerce analytics & Shopify webhooks | Existing A+ platform | Support bot cannot independently verify customer orders or issue returns |
| Workflow automation | Existing A+ automation studio | Support actions are not yet connected to workflows |
| Email/SMS/social unified inbox | Not implemented | Requires provider APIs, inbound signature verification and consent/opt-out support |
| AI voice receptionist | Not implemented | Requires telephony infrastructure, disclosure, testing, compliance and operational monitoring |
| Appointment booking | Not implemented | Requires a reliable scheduling provider and conflict management |
| CRM synchronization | Not implemented | Requires OAuth/integration, field mapping, reconciliation and access controls |
| Refunds, inventory changes, payments | Not implemented | Requires verified customer authentication, platform-specific authorizations and idempotent actions |
| SaaS signup, subscriptions, white-label billing | Partial via existing automation engine | Not wired to a purchasable support product or support-specific entitlements |
| Security/compliance certification | Not claimed | Independent review, threat modeling and live operational testing still required |

## Running locally

Requires Node.js >=22.16 with the built-in SQLite module.

1. Configure distinct admin/ingest credentials and a stable pseudonym key as described in the repository README.
2. Run \`npm run check\`, then \`npm start\`.
3. Navigate to \`/support-admin\` and enter the correct workspace ID and **admin** bearer token (kept in page memory only).
4. Publish an accurate knowledge article for each verified business policy, then navigate to \`/support?workspace=default\` to test the visitor experience.
5. Unknown questions create tickets marked \`pending\`. Staff can reply inside the Support Console. The customer page polls for new messages while open.

### Embedding the customer chat on a merchant site

By default, frame embedding is disabled. Configure a strict, workspace-scoped HTTPS origin allowlist:

\`\`\`dotenv
SUPPORT_EMBED_ORIGINS_JSON={"default":["https://merchant.example"]}
\`\`\`

Then embed the hosted support page on that origin only:

\`\`\`html
<iframe title="Customer support"
  src="https://YOUR-SECURE-A-PLUS-DOMAIN/support?workspace=default"
  width="420" height="670" loading="lazy"></iframe>
\`\`\`

Do not expose admin or ingestion tokens in browser scripts, URL parameters or merchant-side code. The widget operates inside an iframe on the A+ origin; the server uses Content Security Policy \`frame-ancestors\` rather than broad CORS access. Production installation also needs HTTPS, abuse monitoring and security review.

### Optional AI phrasing

Without special configuration, responses are restricted to approved article text. Enable provider paraphrasing **only after verifying the merchant's data-processing arrangements, privacy disclosures and lawful basis**:

\`\`\`dotenv
AI_API_KEY=YOUR_SERVER_SIDE_KEY
SUPPORT_AI_ENABLED=true
SUPPORT_AI_DATA_PROCESSING_ACKNOWLEDGED=true
\`\`\`

The visitor must also check the AI-consent box. The adapter sends the message (which may contain information voluntarily typed by the visitor) and one matched approved article; it does **not** send separately collected name/email fields. The prompt limits replies to verified knowledge; **this is not a formal factual-verification guarantee**. Test the provider carefully. If the provider fails, the system falls back to the approved article. If no article matches, the request is escalated without calling AI.

### Retention, customer access & privacy

\`SUPPORT_RETENTION_DAYS=180\` defaults to 180 days and supports 30–730 days. The existing process runs a daily cleanup and an initial startup cleanup, deleting old support tickets and associated messages. Knowledge articles/settings remain until deleted or their workspace is erased.

\`POST /api/support/privacy/export\` and \`POST /api/support/privacy/erase\` with \`{"email":"customer@example.org"}\` require the tenant admin token. The operator must independently verify the data subject's identity. Tickets with no email are not discoverable by an email-based request. Shopify \`shop/redact\`/uninstall removes the mapped tenant support data, but customer-id redaction cannot reliably match independent support chat records without a verified account linkage. Commerce analytics subject erasure is a separate operation. The support dataset contains personal information in ticket text; protect backups and ensure retention policies apply to them.

## API surface

All routes require \`?workspace=<configured-id>\`.

| Route | Method(s) | Authorization |
| --- | --- | --- |
| \`/api/support/config\` | GET | Visitor/public |
| \`/api/support/chat\` | POST | Visitor/public, rate-limited |
| \`/api/support/thread\` | POST | Ticket ID + random session token |
| \`/api/support/articles\` | GET, POST | Admin |
| \`/api/support/articles/:id\` | PATCH, DELETE | Admin |
| \`/api/support/settings\` | GET, PATCH | Admin |
| \`/api/support/tickets\` | GET (optional \`status\` filter) | Admin |
| \`/api/support/tickets/:id\` | GET, PATCH | Admin |
| \`/api/support/tickets/:id/replies\` | POST | Admin |
| \`/api/support/metrics\` | GET | Admin |
| \`/api/support/privacy/export\` | POST | Admin |
| \`/api/support/privacy/erase\` | POST | Admin |

Sample visitor payload:

\`\`\`json
{"message":"What is your shipping policy?","name":"Optional","email":"customer@example.org","locale":"en","aiConsent":false}
\`\`\`

Response contains \`ticketId\`, \`sessionToken\` (only for the first message), \`reply\`, \`needsHuman\`, \`status\`, and \`source\`. Send \`ticketId\` + \`sessionToken\` with later chat messages, or to \`/api/support/thread\` to retrieve messages. Session tokens grant access to customer conversation content; handle them like credentials. They are not saved in localStorage. A page reload begins a new session. This prototype has no customer identity verification, account-linked ticket recovery, SSO, or real-time push.

## Before claiming production readiness

Perform an independent security and privacy review, run end-to-end UI tests, validate each merchant's configuration, test retention and disaster recovery, ensure public rate limiting at an edge layer, set up incident alerting, and verify all provider terms. Paid support subscriptions and voice, SMS, email, appointments and order-changing actions should be separately developed and tested.
