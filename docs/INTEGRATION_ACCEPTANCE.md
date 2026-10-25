# Integration and recovery acceptance status

Review date: 2026-10-25. Live status check: Neon connected; AI, email, Shopify webhook ingestion, and Square not configured. No live merchant token or email delivery was verified.

This catalog contains 95 setup profiles. A read-only verification endpoint does not establish that all provider actions, scopes, OAuth installation, refresh, or webhooks work. Profiles without a probe still require provider-specific implementation and acceptance testing.

## Repairs

- Recovery AI now passes the configured Bearer token and runtime endpoint/model; HTTPS is required and redirects cannot forward the key.
- Deterministic recovery fallback is explicitly labeled in stored analysis.
- Concurrent outreach send requests claim the draft before SMTP; uncertain delivery is held for reconciliation rather than automatically resent.
- Unified runtime derives a stable encryption key from its server-only pseudonym secret when no explicit integration key is configured.
- Shopify uses its token header and a GraphQL shop query; Brevo and Postmark use their provider headers. Postmark uses the fixed API host.
- Provider-level errors cannot be marked verified; a failed recheck clears old verification.

## Remaining acceptance requirements

Every provider needs an authorized account, the required scopes, and an action-specific end-to-end test. Recovery needs a configured AI endpoint/model/key and SMTP transport, controlled-recipient delivery, inbound reply wiring, and restart/scheduled-run acceptance. Existing standalone recovery code is not proof that every feature is wired into the unified dashboard.

## Catalog inventory

| Service | Read-only probe implemented | Live account verified in this review |
|---|---|---|
| HubSpot | Yes | No |
| Salesforce | No | No |
| Pipedrive | No | No |
| Zoho CRM | No | No |
| Freshsales | No | No |
| Close | No | No |
| Insightly | No | No |
| Copper | No | No |
| HubSpot Marketing | No | No |
| Mailchimp | No | No |
| Klaviyo | No | No |
| Brevo | Yes | No |
| Customer.io | No | No |
| ActiveCampaign | No | No |
| Constant Contact | No | No |
| SendGrid | Yes | No |
| Mailgun | No | No |
| Postmark | Yes | No |
| Resend | No | No |
| Slack | Yes | No |
| Discord | No | No |
| Microsoft Graph | Yes | No |
| Google Drive | Yes | No |
| Google Calendar | Yes | No |
| Gmail | Yes | No |
| Notion | Yes | No |
| Confluence | No | No |
| Dropbox | No | No |
| Box | Yes | No |
| Coda | No | No |
| Airtable | Yes | No |
| Supabase | No | No |
| Neon | No | No |
| Snowflake | No | No |
| Databricks | No | No |
| Asana | Yes | No |
| Trello | No | No |
| ClickUp | Yes | No |
| Monday.com | No | No |
| Jira | No | No |
| Linear | No | No |
| Basecamp | No | No |
| Smartsheet | Yes | No |
| Wrike | No | No |
| GitHub | Yes | No |
| GitLab | Yes | No |
| Bitbucket | No | No |
| Vercel | Yes | No |
| Railway | No | No |
| Cloudflare | Yes | No |
| Sentry | No | No |
| Datadog | No | No |
| Mixpanel | No | No |
| Amplitude | No | No |
| Segment | No | No |
| Plausible | No | No |
| Intercom | Yes | No |
| Zendesk | No | No |
| Freshdesk | No | No |
| Help Scout | Yes | No |
| Gorgias | No | No |
| Front | Yes | No |
| Shopify | Yes | No |
| BigCommerce | No | No |
| WooCommerce | No | No |
| Square | Yes | No |
| Stripe | Yes | No |
| PayPal | No | No |
| QuickBooks Online | No | No |
| Xero | Yes | No |
| Wave | No | No |
| BILL | No | No |
| Gusto | No | No |
| BambooHR | No | No |
| Deel | No | No |
| Rippling | No | No |
| Workday | No | No |
| Harvest | Yes | No |
| Toggl | No | No |
| Clockify | No | No |
| Calendly | Yes | No |
| Acuity | No | No |
| Zoom | Yes | No |
| Webex | Yes | No |
| Twilio | No | No |
| Vonage | No | No |
| Typeform | Yes | No |
| Jotform | No | No |
| DocuSign | No | No |
| PandaDoc | No | No |
| Dropbox Sign | No | No |
| OpenAI API | Yes | No |
| Anthropic API | No | No |
| Cohere | No | No |
| Fireworks AI | No | No |
