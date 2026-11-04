# Executed verification - 28 October 2026

## Local-login configuration follow-up

A later local check found that the API was stopped and pgAdmin occupied port 3000. The running web development server had selected port 3001 while APP_ORIGIN still specified 3000. Root `.env` was aligned to APP_ORIGIN=http://localhost:3001 and WEB_PORT=3001, preserving pgAdmin. Web startup now reads the selected root settings and binds the port explicitly.

The existing saved seed email/password matched the persisted administrator account. The actual credentials passed HTTP login and a separate real-browser login/dashboard/reload/logout check without printing secrets or recording credential traces. No account overwrite or password reset was performed. The full operational browser acceptance scenario also passed on port 3001.

Lint, workspace type checks and **49 tests across seven files** passed after adding port/origin, API-response and configurable-session-lifetime regression cases. SESSION_DAYS now controls session expiry and is validated from 1 to 30 days. `pnpm doctor` checks the database, migrations, saved account, API/proxy, SMTP and storage; `pnpm doctor --login` additionally checks real login/session/dashboard access.

Dependency checks found SMTP on localhost:1025 and object storage on localhost:9000 unavailable, no MALWARE_SCAN_URL, no running jobs worker and no configured OTLP collector. Docker's engine was unavailable. Core login is working; email and document infrastructure still requires configuration. See LOCAL_CONFIGURATION.md for exact commands and findings.

Environment: Windows, Node 22.22.3, pnpm 10.28.2, local PostgreSQL 16. No original reference workbook was available.

## Passed

- Prisma schema formatting/generation and all three migrations applied to separate development and test databases.
- `pnpm lint` and workspace TypeScript checks.
- `pnpm test`: **41 passing checks across five test files**. Real PostgreSQL transactions are used for API, concurrency, permission and outbox tests.
- `pnpm build`: shared package, compiled NestJS API and optimized Next.js application using webpack.
- Playwright in Microsoft Edge against the **compiled API and compiled web server**: one complete multi-user acceptance workflow passed.
- Browser workflow: registration, client/catalog/project/site contract setup, work-order approval, project activation, metadata-aware tracker confirmation, actual receipt, independent site engineer submission, administrator verification/approval, invoice issue, partial payment, Excel/PDF downloads and logout/login persistence.
- Bagmane fixture begins at ordered 2600, supplied 500, installed 192, pending supply 2100, pending installation 2408, on hand 308. The browser test then receives 100 and approves installation of 40, producing supplied 600, installed 232, on hand 368. An installation invoice of 944 with a payment of 200 leaves 744 outstanding.
- Desktop/mobile dashboard screenshots visually inspected. Actual downloaded PDF was rendered, inspected and its project/outstanding text checked. A separate 30-line, four-page PDF layout test was rendered and inspected, including repeating headers and footers.
- Backup script created a custom PostgreSQL dump and SHA-256. Restore script restored it into a newly created isolated database. Native PostgreSQL queries confirmed matching organization, stock movement, invoice and payment allocation counts, net stock quantity and invoice total. This is a local test-data rehearsal, not production RPO/RTO evidence.
- Outbox tests prove concurrent claiming, retry/backoff, stable deduplication identity and fail-closed scanning when no scanner is configured. Email transport is injected in these tests; successful real SMTP delivery is not claimed.

## Not verified

- Docker container builds or deployment: Docker Desktop's engine remained unavailable after a background startup attempt.
- Real S3 uploads and full malware-scanning lifecycle, real SMTP delivery, an OTLP collector or alert delivery.
- Production TLS/ingress/secrets, managed backups/PITR, object-storage recovery, production restore time, business UAT or ASVS compliance.
- Requirements still listed in STATUS.md; tests are not evidence that those unimplemented features exist.

Compiled local services are started on http://localhost:3000 (web) and http://localhost:4000 (API). Re-run `pnpm dev` or the documented compiled start commands after ending the desktop session. Supporting service and secret configuration remains environment-specific.
