# A+ Customer Service Hub

## Scope and current status

This is a working, self-hostable customer-service module integrated with A+'s existing commerce analytics, revenue recovery, and automation. Its database and APIs run locally without a third-party customer-service provider. **It is still a prototype requiring production security, compliance and operations review.** No GitHub Actions are configured or required.

## Locally implemented features

| Category | What works |
|---|---|
| Customer website chat | Ticket-specific conversation, verified-knowledge replies, visitor handoff to staff and 15-second chat polling |
| Business knowledge | Manual article editor, activation/unpublishing, categories, search and atomic JSON or CSV imports (up to 100 per batch) |
| Optional AI | Existing model API can paraphrase an approved answer only when merchant enables it and visitor expressly consents. Default works without an AI key |
| Staff inbox | Search and filter tickets, update priority/status/assignment, save human replies and staff-only notes, insert reusable response macros |
| Workforce | Owner, manager and agent access levels; individual staff login, scrypt password hashes, revocable eight-hour support-only sessions |
| Routing | Least-busy available employee assignment for support handoffs; optional merchant-defined priority phrases |
| Internal alerts | In-app handoff and appointment alerts, elapsed-time first-response/resolution SLA targets and dashboard reporting |
| Customer records | Customer history grouped by self-reported email, never treated as verified identity |
| Leads | Voluntary, separately consented intake and internal lead status management |
| Manual appointment requests | Customer requests a preferred time; staff reviews, no actual reservation is created |
| Internal booking | Merchant-created slots with service, start, duration and capacity; atomic booking/overlap controls and cancellation, recorded only in A+ |
| Attachments | Private customer/staff files, validated PDF/PNG/JPG/TXT/CSV, max 1 MiB each, eight per ticket, 32 MiB per workspace, secure ticket-based access |
| Service quality | Customer satisfaction scores and optional feedback, local trend reports and status counts |
| Privacy controls | Ticket-specific visitor self-export/erasure; admin email-based export/erasure; workspace removal and configured retention |
| Branding | Merchant display name, logo letters, accent color, hours and English/Spanish/French greeting text |
| Multilingual interface | Local English/Spanish/French labels and fallback handoff messages; merchants provide approved FAQs separately in each language |
| Workflow events | Privacy-minimized internal automation triggers, with customer text, email and attachments excluded |
| Source and tests | Node 22+ application, direct Node and HTTP tests, browser smoke testing, without GitHub Actions |

## Start and access

Configure the normal A+ environment: distinct server-only ADMIN_TOKEN and INGEST_TOKEN values of 24+ characters, plus a stable PSEUDONYM_KEY. Node.js 22.16 or newer is required.

From the repository root run:

    npm ci
    npm run verify
    npm start

Open the merchant console at /support-admin and the customer page at /support?workspace=default. The workspace owner signs in with the merchant administrator token and can create individual manager or agent accounts. Individual employee logins do not grant access to the commerce administrator endpoints. Staff credentials are kept in page memory and revoked on server-side logout, account disabling or password change.

The owner can create verified knowledge articles, import JSON/CSV, manage team members and privacy requests. Managers can update business-facing knowledge, service targets, macros and internal availability. Agents can work customer tickets and reply, but cannot administer workspace credentials or export all personal data.

## Customer support workflow

1. A merchant provides accurate, approved information and publishes its FAQs. The default bot uses deterministic FAQ matching. It does not invent a shipping status, payment, refund, or merchant policy when no verified data exists.
2. The customer asks a question. A missing answer marks the ticket for human attention; the customer can also explicitly request a human.
3. A visitor may separately opt into lead follow-up with a name, email and inquiry. This is not broad marketing consent.
4. Staff can answer inside the authenticated dashboard. Customer chats check for new messages approximately every 15 seconds while their page remains open. They do not receive push, SMS or email notifications through this module.
5. The customer can request an appointment for staff review, or book an actual open **A+ internal** slot offered by the merchant. A confirmed_local reservation means only that A+ reserved a slot. An external calendar has not been checked or updated.
6. A customer may rate service, upload permitted files, export customer-visible information, or erase the ticket and its dependent support data.
7. The widget retains the random ticket credential only in same-tab sessionStorage to restore a conversation after a page reload. Starting another conversation or erasing the previous one clears that credential. It is not an email identity check.

## Security and important boundaries

- Customer session credentials are random, hashed at rest, and required to read customer ticket content. Sharing the token gives another holder access; treat it as sensitive.
- Tickets, team members, messages, leads, notes and documents are workspace-scoped. Staff notes never appear in the visitor thread.
- Customer history grouped by self-reported email is **unverified**. Do not use it to authenticate a real bank, legal, health, e-commerce or payment account.
- Attachments are stored as bytes in the local SQLite-backed support database. They are validated by size, extension, signatures or UTF-8, but are **not malware-scanned**. Do not treat uploaded files as trusted.
- Customer self-export returns available ticket data and attachment metadata; file contents can be downloaded separately with the same ticket authorization.
- Staff-only notes are included in authorized merchant exports, not visitor self-export.
- Retention defaults to 180 days for old tickets and their child records, and can be configured using SUPPORT_RETENTION_DAYS (30–730). Merchant security, backups, older snapshots and audit retention require separate attention.
- A customer whose ticket has no email may still erase it with a valid ticket/session token. Staff handling email-based erasure must independently verify identity and match the right records.
- The internal automation engine is given only ticket IDs, status, priority and channel by support triggers. There are no raw customer messages, names, email addresses or attachments in these event payloads.
- Embedding is denied by default. To allow a merchant HTTPS origin, configure SUPPORT_EMBED_ORIGINS_JSON to map workspace names to exact trusted origins. Never embed admin or ingestion tokens on customer websites.
- Public access, payments, account lookups and AI require threat modeling, independent security/privacy review, hosting hardening, monitoring, real backups and penetration testing before regulated or sensitive live data.

## What still requires external integrations

The implementation **does not** claim to provide third-party email/IMAP/SMTP delivery, SMS, WhatsApp/Messenger/social messaging, telephone AI reception, validated customer identity, authenticated Shopify order tracking/refunds, actual external calendar bookings, third-party CRM synchronization, or collected support subscriptions. Those features depend on provider keys, authorization and workflows, legal/consent conditions, validated webhook handlers and separate end-to-end testing.

The existing commerce-intelligence, automation, Shopify webhook and recovery services were not replaced. Running the local module does not automatically deploy it to the internet or guarantee 24/7 uptime.

## Direct verification

Run npm run verify from the repository root. This executes both the main A+ tests and the existing automation/recovery suites. Tests and browser flows are run directly; GitHub Actions is intentionally absent.
