# Implementation and delivery ledger

The workspace was empty on 28 October 2026. No reference CSV/XLSX was supplied. The Bagmane figures in the request are an acceptance fixture, never silently imported production records.

## Architecture

Node 22 LTS, pnpm workspace, Next.js App Router and NestJS modular monolith. MongoDB replica set with Prisma 6.19.2. Exact decimals are stored as strings and calculated using decimal arithmetic. Same-origin reverse proxy routes /api/v1 to Nest. Opaque, hashed, revocable session tokens in HttpOnly cookies. Organization and project checks run in service boundaries. Browser writes require matching Origin and a session CSRF token. Roles are database records with editable permission arrays; project-scoped memberships cannot grant organization administration.

## Ordered delivery gates

1. Database, sessions, invitation/reset, tenant permissions, audit, authenticated shell; unit and real MongoDB API tests.
2. Clients/projects/sites/contacts/work orders/BOQ with versions and lifecycle checks.
3. Preview/confirm import, source hash, opening balances and reconciliation; no invented historical events.
4. Atomic stock ledger, procurement/receipts, idempotency, concurrency tests.
5. Installation submission/verification/approval and controlled reversal.
6. Atomic invoice allocation and partial payment, exact tax/retention calculations.
7. Tasks, private documents, outbox, authorized aggregates and UI.
8. Reports, permission/security/concurrency regression and end-to-end checks.
9. Deployment rehearsal, monitored backups, restoration and UAT.

Each gate must be verified before claiming completion. Detailed actual status and omissions are maintained in docs/STATUS.md. No approval, restoration, malware scan, or UAT is implied by a build passing.

## Business invariants

- Every resource is organization scoped; project membership further restricts nonadministrators.
- Stock movements are immutable. Receipt, consumption and reversal use serializable transactions with retry. Idempotency key and payload hash identify retries and reject key reuse with changed input.
- Imported opening quantities are independently dated balances, not generated receipts/invoices. Accepted historical supplied minus installed is available opening stock only after explicit reconciliation confirmation.
- Installation approval consumes available stock and cannot exceed BOQ approved quantity. Approved historical balances and live events are kept separate.
- Issued invoice quantity never exceeds accepted receipts/approved installation less opening billed and prior live allocations. Financial corrections preserve original rows.
- Quantities and money use numeric, never JavaScript floating point arithmetic in business calculations.
- Reporting must use an explicit as-of date when presenting historical balances.

## Assumptions requiring UAT

Default currency INR; tax rates and contract rules require organization configuration. Pending installation means ordered minus installed; supplied awaiting installation means accepted supplied minus installed. Historical billed quantities do not imply invoice amounts or collections. Date-only source dates must use a confirmed date format. Multi-currency consolidation requires explicit FX rules and is not assumed.

## Compatibility verification

Verified npm package metadata for Next 16.4.3 (Node >=20.9, React 19), Nest 11.2.8 and matching common/platform packages, and Prisma 6.19.2 on Node 22.22.3. Prisma is pinned to the established v6 migration/client interface. See https://nextjs.org/docs/app/getting-started/installation and https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v6. Lockfile is authoritative; dependencies must be scanned before staging rollout.
