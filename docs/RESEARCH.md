# Engineering research: A+ commerce optimization

Reviewed: 2026-10-22. This is a comparison and engineering rationale, not a claim of functional equivalence to the referenced products.

| Reference | Verified idea | A+ implementation |
|---|---|---|
| Shopify webhook authentication | HMAC-SHA256 over exact raw request bytes, idempotent delivery; privacy subscriptions mandatory for public apps | Signature validation + shop allowlist + persistent event IDs + privacy handlers |
| Shopify customer privacy | Data-request, redact-customer and shop-redact are mandatory compliance topics | Redaction routes and customer export with merchant follow-up still needed |
| PostHog | Experiment exposures and events must use the same units and stable assignments | HMAC-stable subject allocation, explicit exposure and 14-day conversions |
| GrowthBook | A/B primary metric, guardrails, eligibility, attribution windows pre-specified | Report labels 14-day window and explicitly marks low sample sizes inconclusive |
| Mautic | Workflow-driven marketing automation | AI provides proposed experiments without automatic outbound actions |
| Saleor | Extensible commerce architecture and webhook adapters | Separate optional Shopify adapter; more integrations required |

Primary sources:
- https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- https://posthog.com/docs/experiments
- https://www.growthbook.io/insights/how-to-design-an-ab-test
- https://github.com/mautic/mautic
- https://github.com/saleor/saleor

## Required before enterprise or App Store use
- Register and deploy actual Shopify webhook subscriptions using an installed application and Shopify app credentials. HMAC receiver code alone is not Shopify approval.
- Merchant-facing completion process for data export requests, registered privacy policies, consent tracking, and deletion verification.
- Production-grade managed data infrastructure, monitoring, recovery drill, secret rotation, RBAC/SSO, security assessment, abuse controls.
- Event-sourced conversion attribution and experiment power planning/correction for sequential peeking and multiple comparisons.
- Consent-aware first-party measurement plus quality assurance against source systems.
- Merchant acquisition, customer retention, and buyer willingness cannot be inferred from repository code.

## Valuation limitations
A code-only valuation is an estimate of transferable intellectual property and replacement cost, not SaaS acquisition value. Code alone cannot establish >85% confidence of any specific sale price without corroborating buyer bids, independent quality/security evidence, and comparable completed code-only asset sales.
