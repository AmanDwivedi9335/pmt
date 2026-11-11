# Development, deployment and recovery

## Local setup

Use Node 22 LTS and pnpm 10.28.2. Copy `.env.example` to `.env`, set real local configuration, then:

```sh
pnpm install --frozen-lockfile
docker compose up -d --wait mongodb minio mailpit
pnpm db:push
pnpm --filter @pmt/shared build
pnpm dev
# In another terminal:
pnpm jobs:dev
```

Open http://localhost:3000 and create an organization. API on :4000; docs `/api/docs`; email preview on :8025. Create the private `pmt-private` bucket in MinIO. Configure a bucket CORS policy permitting the application's exact origin for PUT and GET; keep public access disabled. Signed browser upload endpoints must resolve from the user's browser, not only the container network. The compose application profile requires public S3 endpoint configuration for this reason.

The Compose database is a single-member development replica set exposed on loopback at port 27018. Use an authenticated replica set or Atlas for shared or hosted environments.

Before running `pnpm test`, set `TEST_DATABASE_URL` to a dedicated MongoDB database whose name ends in `_test`. Run `pnpm db:push` with `DATABASE_URL` set to the same URI. Tests reject any database whose name does not end in `_test`. API tests persist uniquely named fixtures; use a disposable database in CI. Rate-limit test counters are reset only in that isolated database.

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e # local API/web must be running; Edge used by browser configuration
```

Next uses webpack on this Windows workspace because Turbopack's process worker failed. No dependency schema synchronization is used. Shared packages must be built before starting a compiled API.

## Background worker

MongoDB workers atomically claim each outbox job with an expiring lease. Failures use exponential backoff with a maximum of eight attempts. Failure state is retained in Outbox. Run one or more worker processes against the same database; do not run a separate Redis queue. Alert on stale pending jobs and attempts=8. For a reviewed manual retry, reset attempts and availableAt for the specific failed job after correcting the dependency; record the operator action externally.

Email delivery is at-least-once; stable Message-ID assists deduplication, but an SMTP acknowledgment followed by process failure can still deliver duplicates. In-app notifications are retained and project scoped. The worker generates deduplicated overdue-task notifications hourly. Additional notification triggers are tracked in STATUS.md.

Scanner integration: set MALWARE_SCAN_URL to a trusted HTTPS service accepting raw bytes via POST and returning JSON `{ "clean": true }` only after a successful scan. Optional MALWARE_SCAN_TOKEN is sent as a bearer token. Timeout 15 seconds. Missing/unavailable scanner leaves uploads quarantined; rejection blocks downloads. Bytes are size/signature checked, scanned, then copied to a different clean object key to prevent reuse of an upload URL from changing an approved file. Configure orphan quarantine cleanup, bucket versioning and lifecycle rules operationally. S3/SMTP/scanner integration must be exercised in staging.

## Staging and production release

Build API/web images from repository root with infra Dockerfiles. Supply secrets from the deployment platform; do not bake `.env` into images. The web reverse proxy uses API_INTERNAL_URL; configure it at build and runtime consistently for the target environment. Use TLS at ingress. APP_ORIGIN must exactly match the public origin; production sets NODE_ENV=production, enabling Secure cookies. Services run as a nonroot user.

### Render API service

| Render setting    | Value                                                                         |
| ----------------- | ----------------------------------------------------------------------------- |
| Root Directory    | Leave blank to use the repository root                                        |
| Build Command     | `pnpm install --frozen-lockfile --prod=false && pnpm --filter @pmt/api build` |
| Start Command     | `pnpm --filter @pmt/api start`                                                |
| Health Check Path | `/api/v1/ready`                                                               |

In **Environment**, set `NODE_VERSION` to the supported Node 22 range (`>=22.12 <23`), `NODE_ENV=production`, and `APP_ORIGIN` to the exact HTTPS origin of the frontend without a trailing slash. Set `DATABASE_URL` to the hosted MongoDB replica set URI, including the database name. For Atlas, use the database user's URI from **Connect → Drivers** and allow connections from the Render service's outbound IP ranges. Keep `DATABASE_URL` and the existing 64-character hex `IDENTITY_MAIL_KEY` in Render's environment settings. Render sets `PORT`, which the API uses when present.

Before the first deploy against a new MongoDB database, run `pnpm db:push` from an environment with index-management credentials for that database. Deploy the latest commit and check that `/api/v1/ready` responds successfully. A fresh database needs a separate data transfer if you want to retain existing accounts and records.

Use a separate index-management role for release commands and a restricted runtime role. Grant the runtime identity only find and insert privileges on the StockMovement and Audit collections to enforce append-only records. Separate databases, buckets, SMTP and credentials for local/staging/production. Use least-privilege S3 access and database network rules. API DB health `/api/v1/ready`; process health `/api/v1/health`. Set liveness/readiness probes separately.

Run `pnpm db:push` in the release step after taking a backup. Review index changes before applying them. For document shape changes, deploy code that reads both shapes before backfilling existing documents. Use a fresh MongoDB database for a PostgreSQL cutover and reconcile records before switching connections. Historical SQL migrations remain in version control for the old PostgreSQL schema.

CI is supplied but branch protection must be configured in the repository host to require its checks. Docker image builds, deployment, actual monitoring connectivity and UAT have not been verified locally. Pin production image digests after vulnerability review; supplied version tags are development starting points.

## Recovery targets proposed for approval

Proposed production RPO: 15 minutes. Proposed RTO: 4 hours. These are targets, not measured guarantees. Achieving them requires managed MongoDB point-in-time recovery, encrypted daily base backups, off-site copies, object-storage versioning/replication, monitoring and successful restoration rehearsals. No production rollout until the business approves these targets and evidence demonstrates them.

For a database-scoped logical backup, pause application and worker writes during the dump. Run `infra/backup.ps1 -DatabaseUrl <secret-connection> -OutputPath <new-backup.archive.gz>` with `mongodump` on PATH. Store the resulting SHA-256 in the backup manifest. Encrypt at rest, restrict access and retain according to policy (proposed 30 daily/12 monthly; obtain approval).

Quarterly restore rehearsal:

1. Provision a new isolated database and private object bucket; never restore over the live system.
2. Verify the backup hash and run `infra/restore.ps1` with `-SourceDatabase` set to the database in the archive and `-ConfirmIsolatedTarget` set. For authenticated restores, specify the authentication database with `authSource` in the target URI.
3. Verify indexes, organization boundaries, record counts, stock totals, invoice/payment reconciliation and representative documents.
4. Run the critical acceptance workflow with outbound email disabled or redirected to a sink.
5. Record elapsed recovery time and data cutoff; compare with approved RPO/RTO.
6. For an incident cutover, stop writes, obtain incident-owner approval, change connections, validate health and reconcile any missing operations before reopening.

Logs are structured JSON with request IDs. Operational logs exclude bodies, cookies and raw tokens. Set OTEL_EXPORTER_OTLP_ENDPOINT to enable the Node SDK's HTTP instrumentation and OTLP trace export; internal exception events omit request data and can be correlated with request IDs. Collector connectivity and alerts must be verified before readiness signoff. Production startup rejects non-HTTPS APP_ORIGIN. Local Compose explicitly uses development API settings; staging/production examples use NODE_ENV=production and separate origins/secrets.

The MongoDB backup and restore commands require a new recovery rehearsal. See VERIFICATION.md for historical PostgreSQL verification.
