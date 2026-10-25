# Integration acceptance status

Updated 2026-10-25 following review of the 14-slide acquisition deck.

See [Deck capability acceptance](DECK_CAPABILITY_ACCEPTANCE.md) for the current feature-to-runtime mapping and validation boundaries.

All 95 catalog profiles now provide credential field definitions, encrypted storage, provider request construction, a verification request, and connected starter-workflow generation. A controlled test saves all 95 connections and executes all 95 generated workflows, including approval gates. Account credentials, tenant details and permissions are supplied by the account owner; these tests do not authenticate live external accounts.

Dashboard service setup wires AI, SMTP, Shopify signed order ingestion, Square subscription configuration and chat embed origins into the runtime. The deployment intentionally permits public application access without login. Secrets are encrypted server-side and not returned by setup APIs.

Automatic OAuth enrollment/refresh and automatic synchronization of every business object are not implemented. Provider-specific business operations use the workflow editor; the starter workflow verifies connection access. See the capability acceptance document for the exact scope.
