# REST contract

Base URL `/api/v1`; interactive route documentation `/api/docs` and machine-readable route index `/api/docs-json`.

Authentication uses `pmt_session`, a HttpOnly, SameSite=Lax cookie (Secure in production). All writes require the exact configured `Origin`. Authenticated writes additionally require `x-csrf-token` returned by `/auth/me`. Organization routes require UUID `x-organization-id`. The server validates both membership and project assignment. Role permissions are stored in PostgreSQL.

Mutation errors use `{ "error": { "code": 400, "message": "Validation failed", "fields": { "fieldErrors": {} }, "requestId": "..." } }`. Decimal quantities and amounts are strings. Calendar dates use ISO YYYY-MM-DD. UUIDs identify resources. Mutation endpoints return 201, reads 200, validation 400, session 401, permission 403, hidden resources 404, conflicts 409, rate limits 429.

## Idempotency

Receipts, returns, purchase orders, dispatches, installation creation/transitions, invoice draft/issue/cancel, and payments require a 16–128 character `Idempotency-Key`. Reuse the same key and body after network failure. A matching retry returns the original persisted result. Reuse with a different operation/body returns 409. Keys are scoped to the organization and are not expired automatically.

## Identity and administration

- POST `/auth/register`: email, password (12–128 chars), name, organization. Creates an administrator and nine database roles atomically.
- POST `/auth/login`: email, password. Persistent per-email and per-IP rate limits.
- GET `/auth/me`: user, CSRF token, active organization memberships and role permissions.
- POST `/auth/logout`, `/auth/renew`, `/auth/revoke-all`.
- POST `/auth/forgot-password`: email. Generic response, single-use link placed in transactional email outbox.
- POST `/auth/reset-password`: token, password. Revokes sessions.
- POST `/auth/accept-invitation`: token, name, password. Existing users must prove their existing password.
- POST `/organizations`: name; authenticated user creates another organization.
- PATCH `/organizations`: name and/or currency (INR, USD, EUR, GBP, AED, SGD). Currency changes are blocked after invoicing starts.
- PATCH `/organizations/members/:member`: roleId,active. Grants are bounded by the administrator's own permissions and the last active administrator cannot be removed.
- GET `/organizations/team`, GET/POST `/organizations/roles` (name, permission array).
- POST `/organizations/invitations`: email, roleId. Email queued; raw token never returned by the API.

## Project setup

- GET/POST `/clients`; PATCH `/clients/:id` supports soft archival.
- GET `/projects?page=1&pageSize=50&search=...&status=ACTIVE` returns rows,total,page,pageSize (max 100).
- POST `/projects`: clientId, code, name, city, optional descriptive/date/financial fields.
- GET/PATCH `/projects/:id`; patch requires current integer version.
- POST `/projects/:id/status`: status, version, reason. Historical closed/cancelled projects are locked.
- POST `/projects/:id/members`: membershipId, remove (default false).
- POST `/projects/:id/sites`: name,address; `/contacts`: name,role,email,phone.
- GET/POST `/materials`: sku,name,uom,precision (0–4),category,description,standardRate,taxRate.
- POST `/projects/:id/work-orders`: number.
- POST `/projects/:id/work-orders/:wo/items`: materialId,ordered,supplyRate,installationRate,taxRate,reason. Draft only; snapshot revision is retained.
- POST `/projects/:id/work-orders/:wo/approve`.

## Historical import

POST `/projects/:id/imports/preview`: fileName (.csv/.xlsx), base64 content (max decoded 5 MB), optional sheet, headerRow (1-based), mapping (semantic field to zero-based column index), skipRows (1-based), dateFormat. Returns metadata, headers, mapping, normalized records with row errors, warnings and source hash. It never changes data.

POST `/projects/:id/imports/confirm`: same source configuration plus workOrderId,asOf,confirmed=true,acceptedReceiptAssumption=true,acknowledgeWarnings=true. Existing BOQ and ordered quantities must match. Errors must be resolved; columns with dates require an explicit format. Historical date columns are preserved as evidence without invented events. Import occurs atomically and cannot overlap active opening balances or existing operations.

GET `/projects/:id/imports`; POST `/projects/:id/imports/:batch/reverse` with reason. Downstream stock, installation or invoice records block reversal.

## Procurement and stock

- GET/POST `/suppliers`: name,email,taxId.
- GET/POST `/projects/:id/purchase-orders`: supplierId,number,lines[{boqItemId,quantity,rate}].
- POST `/projects/:id/purchase-orders/:po/approve`.
- POST `/projects/:id/dispatches`: purchaseLineId,challan,quantity.
- POST `/projects/:id/goods-receipts`: dispatchId,reference,accepted,damaged,rejected,reason. Only accepted quantities add stock; partial receipts cannot exceed dispatch.
- POST `/projects/:id/receipts`: boqItemId,quantity,reference,notes; independently accepted receipt with a delivery reference.
- POST `/projects/:id/returns`: boqItemId,quantity,reference,reason. Cannot consume installed or billed quantities.
- GET `/projects/:id/movements`: latest 100 immutable movement records.
- GET `/projects/:id/balances?asOf=YYYY-MM-DD`: opening plus ledger totals, pending quantities and unbilled quantities. Contract baseline is current; posted movements are filtered by posting date.

## Installation

GET/POST `/projects/:id/installations`: boqItemId,quantity,area,reportDate,notes. Creates a draft. POST `/projects/:id/installations/:entry/transition`: status,version,reason. DRAFT→SUBMITTED→VERIFIED→APPROVED. Independent reviewer required. REJECTED requires a reason. Approved records may be REVERSED when billing allocations permit. Quantities are consumed only at approval; stock and approval commit together.

## Billing

- GET/POST `/projects/:id/invoices`: number,kind (SUPPLY or INSTALLATION),dueDate,retentionPercent,lines[{boqItemId,quantity}]. Rates/taxes come from BOQ, not client input. Monetary rounding is per-line to two places, half up; retention is based on pretax subtotal.
- POST `/projects/:id/invoices/:invoice/issue`: atomic eligibility check and issuance.
- POST `/projects/:id/invoices/:invoice/cancel`: reason. Paid invoices cannot be cancelled through this workflow.
- GET/POST `/projects/:id/payments`: amount,reference,receivedAt,allocations[{invoiceId,amount}]. Allocated totals cannot exceed payment or issued invoice balances. Unallocated remainder is retained on payment.

## Collaboration, documents, reports

- GET/POST `/projects/:id/tasks`; PATCH `/tasks/:task` with version and updated fields.
- GET `/projects/:id/activity`, `/notifications`, `/documents`.
- POST `/projects/:id/documents/upload`: name,mimeType,size. Returns five-minute private upload URL. Max 10 MB, PDF/JPEG/PNG.
- POST `/projects/:id/documents/:doc/complete`: validates stored metadata and queues scan.
- GET `/projects/:id/documents/:doc/download`: returns a one-minute private signed URL only for CLEAN files. Scanner verifies magic bytes and moves verified bytes to a different immutable object key.
- GET `/dashboard`: filters projectId,clientId,city,manager,status. Totals and value-weighted progress use authorized records.
- GET `/projects/:id/export?asOf=...`: Excel workbook with project metadata, material quantities and billing reconciliation.
- GET `/projects/:id/export.pdf?asOf=...`: PDF project progress and billing report.

Some list endpoints currently cap at 100 records; full pagination across all modules and fully typed request/response OpenAPI schemas are remaining work. Do not interpret the generated route index as full schema documentation.

## Staff access and assigned work

- `GET/POST /api/v1/organizations/teams`, `PATCH/DELETE /api/v1/organizations/teams/:teamId`, and `GET/POST /api/v1/organizations/teams/:teamId/members` manage organization teams and memberships. Add an active member by email and remove them with `DELETE /api/v1/organizations/teams/:teamId/members/:membershipId`. Team names are unique per organization regardless of case. Team groups are organizational records. Project access continues to use project membership.
- `POST /api/v1/organizations/staff` accepts `name`, `email`, `roleId`, and an initial `password`. Organization administrators with staff management permission can create a new identity and active membership together. Existing identities must use invitation or membership management. The endpoint returns only the public account fields and membership.
- `GET /api/v1/organizations/staff` returns tenant-scoped membership pages of 25. It accepts `page`, `search` (name or email), `access` (`all`, `active`, `inactive`), and `sort` (`name`, `newest`). Requires `team.manage`.
- `GET /api/v1/organizations/invitations?page=1` lists invitation states. `POST /api/v1/organizations/invitations/:id/resend` rotates the link and queues a replacement. `POST /api/v1/organizations/invitations/:id/revoke` closes the invitation. Both actions require `team.manage` and authority over the invited role. Existing members are managed through membership access.
- `GET /api/v1/auth/sessions` lists the caller's active sessions. `DELETE /api/v1/auth/sessions/:id` revokes a session belonging to the caller. `POST /api/v1/auth/change-password` requires the current password and revokes all sessions and outstanding reset links.
- `GET /api/v1/workspace/my-tasks` returns 25 tasks per page that are assigned to the caller and belong to projects the caller can access. Query parameters are `page` and `state` (`open`, `completed`, `all`).
- Project task editing remains versioned. Assignment and general edits require both `task.manage` and `project.edit`. A task manager without project editing access can set `TODO`, `IN_PROGRESS`, or `BLOCKED` on their own open tasks. Staff can submit an in-progress task for review by setting `IN_REVIEW`. A manager then sets `DONE` to approve or `CHANGES_REQUESTED` to return it. A manager can pass `null` for `assigneeId` or `dueDate` to clear those fields.

Set the same independently generated 32-byte hex `IDENTITY_MAIL_KEY` on the API and mail worker before restarting either service. Keep it in the deployment secret store. Keep the key stable until queued identity mail has been delivered. New invitation and password reset outbox entries are encrypted, and successful delivery clears the payload. The worker still reads the previous plaintext email format for existing jobs. `INVITATION_HOURS` defaults to 48 and accepts 1–168. Apply the invitation lifecycle and team group migrations before deploying the API.

For deployment, take a database backup and apply both additive migrations before rolling out the API and worker. If the application rollout needs to be reversed, keep the additive columns and tables in place to preserve new staff records. Use a worker version that can decode encrypted queued mail until those jobs drain. Verify readiness and test invitation delivery through the configured SMTP transport before enabling onboarding.
