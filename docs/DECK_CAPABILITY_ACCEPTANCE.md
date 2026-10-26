# Acquisition deck capability acceptance

Scope: A_Plus_Acquisition_Deck_Redesigned.pdf, 14 slides, reviewed 2026-10-25.

| Deck capability | Connected application path | Validation |
|---|---|---|
| Website scans and AI summaries | Recovery → scanner → AI → saved site and draft | Scanner and AI regression tests; explicit fallback when AI is unavailable |
| Reviewed opportunities, priorities, leads, replies and outreach | Recovery APIs and dashboard | Workspace persistence, draft generation, concurrent send handling, SMTP fixture delivery |
| Recurring reviews and discovery | Recovery routine → scheduled worker → saved site | Routine opt-in tests; stale scan lease recovery; existing Neon 15-minute trigger |
| Revenue, orders, cart/visit/lead activity | Commerce event ledger → overview and campaign reports | Deduplication, cents arithmetic, consent, persistence, attribution tests |
| Campaign spend and A/B experiments | Commerce forms → ledger and experiment engine | HTTP integration and experiment tests |
| Visual workflow builder, schedules, triggers, approvals and AI | Workflow Studio → durable automation engine | Execution, approvals, retries, schedules, subworkflows and event-routing suites |
| Support chat, inbox, staff assignment, notes, saved replies | Support console and visitor chat | Knowledge, routing, attachment, ticket, branding and team suites |
| Leads, bookings, response times and feedback | Support leads/calendar/reports | Booking capacity, cancellation, satisfaction, SLA and service tests |
| 95 application setups | Connected apps → encrypted credential record → provider request → workflow | All 95 profiles traversed with controlled provider responses; no real provider account credentials supplied |
| Shopify paid-order receiver | Signed webhook → commerce ledger → automation event | Signature, duplicate delivery, order ingestion and redaction tests |
| Growth Agent | Workspace-scoped action plan, saved objective/window, audited runs, opt-in processing of existing recovery queue | Growth-agent plan/policy tests; recovery queue retains consent and stop-condition enforcement |
| Product Catalog Intelligence | Workspace-scoped catalog, deduplicated product events, consented co-purchase recommendations, margin-aware price guidance | Catalog unit tests cover event idempotency, consent, recommendations, margin alerts and customer erasure |
| Buyer-supplied service configuration | Settings → encrypted storage → runtime consumers | AI/email/Shopify/Square setup, secret redaction and reload tests |
| Public access | Main dashboard and support console | No app credentials required in explicit public mode; private mode remains available |

## Changes in this review

- Embedded all support pages, scripts and CSS in the Neon bundle; previously those routes attempted to read files absent from the deployment archive.
- Added dynamic provider-specific forms, Basic/header/Bearer/query authentication, tenant/account identifiers, verification requests, and credential replacement without breaking workflow references.
- Added “Use in workflow” to build a connected workflow with its endpoint, method, saved credential and host allowlist already populated.
- Removed the first-16/first-12 catalog display limits; all 95 entries are accessible.
- Added encrypted installation settings, including AI endpoint/model/key, SMTP, Shopify ingestion, Square plans and webhook settings, and chat embed origins.
- Honored the explicit public/no-login deployment requirement in the dashboard and support console.
- Made credentialed HTTP requests work with dual-stack DNS and Node's lookup callback formats.
- Exposed support event triggers in the dashboard. Recovery scans can reclaim an interrupted scan after its 15-minute lease.

## Verification boundary

Controlled tests verify the application's plumbing and request construction. They do not authenticate 95 real external accounts or guarantee provider availability, plan eligibility, API scope grants, OAuth enrollment or token lifetime. Account owners supply provider credentials and required tenant/instance details. The Verify action checks those credentials against the provider at setup time. Workday additionally requires its tenant-specific REST resource path. Tokens can be replaced in place when providers expire or revoke them. Automatic OAuth enrollment and refresh are not implemented.

Provider-specific business operations are configured in the workflow editor using that provider's API. The generated starter workflow performs the connection's read-only verification request; it does not invent a business action or automatically synchronize all provider data.

## Provider references checked

- Shopify: https://shopify.dev/docs/api/admin-graphql/latest
- WooCommerce: https://developer.woocommerce.com/docs/apis/rest-api/authentication
- BigCommerce: https://docs.bigcommerce.com/developer/api-reference/rest/admin/overview
- Zoho: https://www.zoho.com/crm/developer/docs/api/v8/list-available-rest-apis.html
- Klaviyo: https://developers.klaviyo.com/en/docs/changelog_
- Xero: https://developer.xero.com/documentation/best-practices/data-integrity/managing-tokens/
- Twilio: https://www.twilio.com/docs/usage/requests-to-twilio
- Pipedrive: https://pipedrive.readme.io/docs/core-api-concepts-authentication
- Freshsales: https://developers.freshworks.com/crm/api/
- BILL: https://developer.bill.com/reference/getsessioninfo
- Rippling: https://developer.rippling.com/documentation/rest-api/reference/list-users
- Snowflake: https://docs.snowflake.com/en/en/developer-guide/snowflake-rest-api/authentication
