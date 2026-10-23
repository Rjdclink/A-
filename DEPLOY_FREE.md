# A+ Unified Growth Platform — $0 hosting with GitHub and Neon

## Recommended free hosting: VibeNest Free

VibeNest currently advertises one free Node.js web server with 256 MB RAM, 0.5 vCPU, 4 GB storage and an HTTPS subdomain. It supports private GitHub repositories and persistent storage. Free allowances, account verification, maintenance and uptime are controlled by the provider. See https://vibenest.net/pricing and https://vibenest.net/.

Source: private GitHub repository Rjdclink/A-.
Existing Neon projects remain separate; enable the optional Neon PostgreSQL activity-history integration using the NEON_DATABASE_URL environment variable.

## Deploy the reviewed branch

1. Sign in to VibeNest and authorize read-only GitHub access only to Rjdclink/A-. Choose the reviewed integration branch. Do not use GitHub Actions.
2. Create a Free Node web service using the repository Dockerfile. Node.js 22.16 or newer is required. Configure the persistent volume mount at /data. Use the container port supplied by the host; A+ binds to the platform PORT on HOST=0.0.0.0.
3. Configure these values in the host's encrypted environment-variable editor. Never commit them to GitHub or paste them into chat:
   ADMIN_TOKEN — unique cryptographically random 32+ character token;
   INGEST_TOKEN — different cryptographically random 32+ character token;
   PSEUDONYM_KEY — third stable cryptographically random 32+ character key;
   NEON_DATABASE_URL — optional Neon PostgreSQL connection string with least-privilege permissions, never a key exposed in client-side code.
4. Other environment values:
   HOST=0.0.0.0
   DB_PATH=/data/a-plus.sqlite
   AUTOMATION_DB_PATH=/data/automation.sqlite
   BACKUP_DIR=/data/backups
   AUTO_BACKUP_HOURS=24
   BACKUP_RETAIN=7
   SESSION_COOKIE_SECURE=true
   ALLOW_SIGNUP=false
   NODE_ENV=production
5. Do not enable SMTP, Shopify, Square, or external AI actions without their own appropriate credentials, verified signatures, provider access and subscriptions. App catalog entries are setup profiles, not pre-authorized connections.
6. Deploy, obtain the actual HTTPS subdomain, and check /health, the dashboard, data persistence across restarts, and all enabled third-party integrations. Set up independently stored backups.

## Storage design

A+ commerce and GrowthVeyra workflow execution currently use persistent SQLite files under /data. The database volume must persist across rebuilds; setting NEON_DATABASE_URL does NOT move those data stores to Postgres. Neon PostgreSQL stores an optional tenant-scoped stream of limited operational events in the aplus_integration_events table. Neon status and event counts appear under Settings.

Neon Functions are not conventional static-site hosting. The browser dashboard must be hosted by the selected web service or other real frontend host.

## Verification

Run npm ci and npm run verify before deployment. Inspect /health over HTTPS, connect using the A+ administrator token, test every dashboard section, and verify each workflow's observable output. Test an event-triggered workflow with external actions disabled. Test live service integrations only with configured credentials. Verify database integrity and actual restart persistence.

Never represent the public dashboard as deployed or 100% functional until the selected host returns a verified URL and production acceptance tests pass.
