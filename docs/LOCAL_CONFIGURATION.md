# Local login and configuration check

## Current Windows setup

The portal is configured at **http://localhost:3001**. pgAdmin already uses port 3000, so it was left running. The API listens on port 4000; PostgreSQL listens on 5435.

The root `.env` now has matching settings:

```dotenv
APP_ORIGIN=http://localhost:3001
WEB_PORT=3001
API_PORT=4000
NODE_ENV=development
SESSION_DAYS=7
```

Credentials remain in the existing ignored `.env`; no credentials are reproduced here. The saved SEED_EMAIL and SEED_PASSWORD were verified against the persisted administrator account and through actual HTTP and browser login. Browser verification also checked dashboard loading, session persistence on reload and logout.

Login authenticates against a password hash in PostgreSQL. SEED_EMAIL/SEED_PASSWORD select credentials for initial development seeding and explicit diagnostics. Changing those environment variables does not reset an existing account's password. No password reset or account overwrite was needed for this fix.

## Start and check

From the repository root in PowerShell:

```powershell
pnpm dev
```

This starts both API and web. Keep it running, and open the exact APP_ORIGIN URL. The web launcher loads the required root environment settings and explicitly binds WEB_PORT. If that port is occupied, startup fails rather than silently switching to a port the API would reject.

In another terminal:

```powershell
pnpm doctor
pnpm doctor --login
```

The first command checks configuration and dependent services. The second additionally submits the saved credentials to the real login endpoint, checks session/dashboard access, and logs out that diagnostic session. It prints no passwords, cookies or tokens. Avoid repeated login diagnostics in a tight loop; normal login rate limits still apply.

PostgreSQL must be running before using the portal. This workspace's existing loopback-only development cluster can be started, if stopped, with:

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\pg_ctl.exe' -D '.local/postgres' -l '.local/postgres.log' -o '-p 5435 -h 127.0.0.1' start
```

## Dependency findings

| Component                       | Finding                                                         | What to configure                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL and migrations       | Passed; all three existing migrations applied                   | Existing DATABASE_URL works.                                                                                                                                             |
| Saved administrator credentials | Passed database comparison, HTTP login and browser login        | Use the existing SEED_EMAIL/SEED_PASSWORD values.                                                                                                                        |
| Web/API routing                 | Fixed and verified                                              | Keep APP_ORIGIN and WEB_PORT aligned. API_INTERNAL_URL can override the API upstream; otherwise API_PORT is used.                                                        |
| Session lifetime                | SESSION_DAYS is now honored and tested                          | Integer from 1 to 30; default 7 days.                                                                                                                                    |
| Email                           | localhost:1025 unavailable                                      | Start Mailpit for local email, or configure SMTP_HOST, SMTP_PORT, SMTP_FROM and optional SMTP_USER, SMTP_PASSWORD, SMTP_SECURE. No test email was sent.                  |
| Private document storage        | localhost:9000 unavailable; bucket access could not be verified | Start MinIO or configure S3_ENDPOINT, S3_PUBLIC_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY. Nonempty example keys do not establish working storage. |
| Malware scanner                 | MALWARE_SCAN_URL absent                                         | Configure a trusted scanner endpoint (optional MALWARE_SCAN_TOKEN). Documents remain quarantined until scanning succeeds.                                                |
| Background jobs                 | No worker was running                                           | After dependencies are configured, run `pnpm jobs:dev` separately for queued emails/scans/notifications.                                                                 |
| Telemetry                       | No OTLP endpoint configured                                     | Optional locally; configure OTEL_EXPORTER_OTLP_ENDPOINT and verify delivery for monitored deployments.                                                                   |
| Docker                          | Engine unavailable during this check                            | Start Docker Desktop before using Compose.                                                                                                                               |

Once Docker is running, the existing native PostgreSQL can be retained while starting only email and storage:

```powershell
docker compose up -d minio mailpit
```

Create the private `pmt-private` bucket in MinIO and configure bucket CORS for the actual portal origin, currently http://localhost:3001. The browser must be able to resolve S3_PUBLIC_ENDPOINT. Starting MinIO alone does not complete bucket/CORS/scanner setup. Existing template credentials are local-development defaults, not production secrets.

The missing email/storage/scanner services do not block core login, projects, inventory or operational billing. They do block the corresponding email/document workflows.
