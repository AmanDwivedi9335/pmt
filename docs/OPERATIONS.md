# Development, deployment and recovery

## Local setup

Use Node 22 LTS and pnpm 10.28.2. Copy `.env.example` to `.env`, set real local configuration, then:

```sh
pnpm install --frozen-lockfile
docker compose up -d postgres minio mailpit
pnpm db:generate
pnpm db:migrate
pnpm --filter @pmt/shared build
pnpm dev
# In another terminal:
pnpm jobs:dev
```

Open http://localhost:3000 and create an organization. API on :4000; docs `/api/docs`; email preview on :8025. Create the private `pmt-private` bucket in MinIO. Configure a bucket CORS policy permitting the application's exact origin for PUT and GET; keep public access disabled. Signed browser upload endpoints must resolve from the user's browser, not only the container network. The compose application profile requires public S3 endpoint configuration for this reason.

On this workspace, Docker's engine was stopped. A disposable PostgreSQL 16 cluster was initialized under ignored `.local/postgres`, bound to 127.0.0.1:5435 with trust authentication for local testing only. Never copy that local authentication configuration to staging or production. Its local database names are `pmt` and `pmt_test`. It may be stopped with PostgreSQL `pg_ctl -D .local/postgres stop`. Use Docker's password-protected configuration for shared development.

Run migrations on a dedicated `*_test` database before `pnpm test`. Set TEST_DATABASE_URL. Tests reject any database whose name does not end in `_test`. API tests persist uniquely named fixtures; use a disposable database in CI. Rate-limit test counters are reset only in that isolated database.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e # local API/web must be running; Edge used by browser configuration
```

Next uses webpack on this Windows workspace because Turbopack's process worker failed. No dependency schema synchronization is used. Shared packages must be built before starting a compiled API.

## Background worker

The PostgreSQL outbox uses `FOR UPDATE SKIP LOCKED`, exponential backoff and a maximum of eight attempts. Failure state is retained in Outbox. Run one or more worker processes against the same database; do not run a separate Redis queue. Alert on stale pending jobs and attempts=8. For a reviewed manual retry, reset attempts and availableAt for the specific failed job after correcting the dependency; record the operator action externally.

Email delivery is at-least-once; stable Message-ID assists deduplication, but an SMTP acknowledgment followed by process failure can still deliver duplicates. In-app notifications are retained and project scoped. The worker generates deduplicated overdue-task notifications hourly. Additional notification triggers are tracked in STATUS.md.

Scanner integration: set MALWARE_SCAN_URL to a trusted HTTPS service accepting raw bytes via POST and returning JSON `{ "clean": true }` only after a successful scan. Optional MALWARE_SCAN_TOKEN is sent as a bearer token. Timeout 15 seconds. Missing/unavailable scanner leaves uploads quarantined; rejection blocks downloads. Bytes are size/signature checked, scanned, then copied to a different clean object key to prevent reuse of an upload URL from changing an approved file. Configure orphan quarantine cleanup, bucket versioning and lifecycle rules operationally. S3/SMTP/scanner integration must be exercised in staging.

## Staging and production release

Build API/web images from repository root with infra Dockerfiles. Supply secrets from the deployment platform; do not bake `.env` into images. The web reverse proxy uses API_INTERNAL_URL; configure it at build and runtime consistently for the target environment. Use TLS at ingress. APP_ORIGIN must exactly match the public origin; production sets NODE_ENV=production, enabling Secure cookies. Services run as a nonroot user.

For a Render Node web service, leave **Root Directory** blank so the build can access the whole pnpm workspace. Set **Build Command** to `pnpm install --frozen-lockfile --prod=false && pnpm --filter @pmt/api build` and **Start Command** to `pnpm --filter @pmt/api start`. The API build generates Prisma Client and compiles `@pmt/shared` before compiling the API. Keep database migrations in the release step.

Separate database roles: migration owner for reviewed deploy commands and restricted runtime role (no ALTER/DROP; immutable triggers retained). Separate databases, buckets, SMTP and credentials for local/staging/production. Use least-privilege S3 access and database network rules. API DB health `/api/v1/ready`; process health `/api/v1/health`. Set liveness/readiness probes separately.

Run `prisma migrate deploy` as a controlled, approved release job after backup, never at API startup. Review generated SQL and lock duration. Add forward-compatible columns first, deploy application changes, backfill, then remove old columns in a later release. Migrations have no automatic destructive down scripts. A failed release normally rolls back application images; data rollback requires a reviewed forward repair or recovery to an isolated database.

CI is supplied but branch protection must be configured in the repository host to require its checks. Docker image builds, deployment, actual monitoring connectivity and UAT have not been verified locally. Pin production image digests after vulnerability review; supplied version tags are development starting points.

## Recovery targets proposed for approval

Proposed production RPO: 15 minutes. Proposed RTO: 4 hours. These are targets, not measured guarantees. Achieving them requires managed PostgreSQL WAL archiving/PITR, encrypted daily base backups, off-site copies, object-storage versioning/replication, monitoring and successful restoration rehearsals. No production rollout until the business approves these targets and evidence demonstrates them.

Daily backup example: `infra/backup.ps1 -DatabaseUrl <secret-connection> -OutputPath <new-backup.dump>` (pg_dump must be on PATH). Store the resulting SHA-256 in the backup manifest. Encrypt at rest, restrict access and retain according to policy (proposed 30 daily/12 monthly; obtain approval).

Quarterly restore rehearsal:

1. Provision a new isolated database and private object bucket; never restore over the live system.
2. Verify backup hash and restore using infra/restore.ps1 with ConfirmIsolatedTarget.
3. Verify migration history, organization boundaries, record counts, stock totals, invoice/payment reconciliation and representative documents.
4. Run the critical acceptance workflow with outbound email disabled or redirected to a sink.
5. Record elapsed recovery time and data cutoff; compare with approved RPO/RTO.
6. For an incident cutover, stop writes, obtain incident-owner approval, change connections, validate health and reconcile any missing operations before reopening.

Logs are structured JSON with request IDs. Operational logs exclude bodies, cookies and raw tokens. Set OTEL_EXPORTER_OTLP_ENDPOINT to enable the Node SDK's HTTP instrumentation and OTLP trace export; internal exception events omit request data and can be correlated with request IDs. Collector connectivity and alerts must be verified before readiness signoff. Production startup rejects non-HTTPS APP_ORIGIN. Local Compose explicitly uses development API settings; staging/production examples use NODE_ENV=production and separate origins/secrets.

The local backup/restore scripts were exercised against test data, with a new isolated target and matching aggregate counts/quantity/financial totals. This does not validate a managed production backup policy or its recovery targets. See VERIFICATION.md for the executed checks.
