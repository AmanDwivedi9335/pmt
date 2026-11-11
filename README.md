# Fieldwork - Project Operations Portal

A pnpm monorepo with a working Next.js application, NestJS REST API and MongoDB persistence. The implemented operational path covers client/project setup, work orders and BOQ, confirmed historical tracker imports, procurement/dispatch/receipts, an immutable project stock ledger, installation approval and reversal, quantity-limited invoicing, partial payment, tasks and reports.

**This is an implemented and tested operational baseline. It does not yet fulfill the entire master specification or qualify as production-ready.** See [delivery status and remaining requirements](docs/STATUS.md) before using it for live business operations.

## Run

Requires Node 22 LTS, pnpm 10.28.2 and a MongoDB replica set. Use Docker Compose for local supporting services:

```sh
cp .env.example .env
pnpm install --frozen-lockfile
docker compose up -d --wait mongodb minio mailpit
pnpm db:push
pnpm dev
```

Open [the portal](http://localhost:3000), create an organization and invite your team. [API route documentation](http://localhost:4000/api/docs) is available after starting the API. Run `pnpm jobs:dev` separately for queued email, scans and notifications.

Use the `APP_ORIGIN` URL from your root `.env` if it differs from the template. For local Windows development, port 3001 avoids the conflict with pgAdmin on port 3000. `pnpm dev` binds `WEB_PORT` and loads the root web/API routing settings. Run `pnpm doctor` (or `pnpm doctor --login` to test saved seed credentials) to diagnose local services. See [local configuration](docs/LOCAL_CONFIGURATION.md).

Optional development fixture: set NODE_ENV=development, SEED_EMAIL and a strong SEED_PASSWORD in your local environment, then run `pnpm db:seed`. The seed refuses existing accounts and never runs in production. It creates the Bagmane opening figures from `tests/fixtures/bagmane-acceptance.csv`. **The original reference workbook was not present in the workspace.** The included fixture is explicitly transcribed from the request.

## Verification

```sh
# Set TEST_DATABASE_URL to a MongoDB database whose name ends in _test.
# Run pnpm db:push with DATABASE_URL set to that same URI before testing.
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Browser tests require the local API/web and Microsoft Edge (or change the Playwright channel to your installed browser). Database tests cover real MongoDB transactions, tenant/project access, duplicate receipts, concurrent stock deductions, installation limits, competing invoices, partial payments, invalid workflow rollback, historical balances and exports.

## Documentation

- [Architecture, assumptions and ordered plan](docs/IMPLEMENTATION.md)
- [REST contracts and business workflows](docs/API.md)
- [Setup, deployment, outbox, backup and recovery](docs/OPERATIONS.md)
- [Actual delivery status and limitations](docs/STATUS.md)
- [Executed verification evidence](docs/VERIFICATION.md)
- [Production-readiness and UAT checklist](docs/PRODUCTION_READINESS.md)

No credentials are committed. Local `.env`, database files, test outputs and screenshots are ignored. For hosted development or deployment, set `DATABASE_URL` to an authenticated MongoDB replica set or Atlas cluster.
