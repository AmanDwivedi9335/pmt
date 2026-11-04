# Production-readiness and UAT checklist

The portal must not be declared production-ready until all applicable items have evidence and a named business/technical owner. unchecked items are pending.

## Product scope

- [ ] Close each required gap in STATUS.md or obtain an explicit, recorded phased-release scope decision.
- [ ] Reconcile the original Bagmane workbook and confirm source metadata, date formats, receipt assumptions and billed opening quantities.
- [ ] Approve UOM precision, rates, GST rules, invoice numbering, currency, retention, certification and exceptional workflows.
- [ ] Confirm location/warehouse inventory needs before posting any real stock; current implementation pools project stock.
- [ ] Complete role-by-role UAT for administrators, managers, engineers, procurement, stores, accounts, management and client viewers.

## Acceptance workflow

- [ ] Admin creates Bagmane client/project, Bangalore location, site and contacts, work order 4500016760 and approved material catalog/BOQ.
- [ ] Original tracker preview identifies metadata/table correctly and flags reconciliation issues before confirmation.
- [ ] Opening figures: 2600 ordered, 500 accepted supplied, 192 installed, 2100 pending supply, 2408 pending installation, 308 supplied awaiting installation.
- [ ] Storekeeper records a valid receipt; exact HTTP retry does not duplicate it.
- [ ] Engineer submits installation; independent authorized manager verifies/approves; stock/progress update atomically.
- [ ] Accounts issues eligible quantities once, records partial receipt, and reconciles outstanding.
- [ ] Authorized user exports and reviews project progress/billing report; unauthorized users cannot export or read other projects/organizations.
- [ ] Logout/login retains records and refreshes permissions.

## Security

- [ ] Complete appropriate OWASP ASVS 5.0 assessment; record findings and remediation evidence.
- [ ] TLS ingress, exact APP_ORIGIN, Secure cookies, CSRF/Origin behavior and reverse-proxy trust settings tested.
- [ ] Disable unwanted public registration or add provisioning policy for private enterprise deployment.
- [ ] Review password policy, rate limits, audit retention, invitation/reset token lifetime and membership offboarding.
- [ ] Least-privilege runtime DB role, migration role, private S3 policies, key rotation and secret manager configured.
- [ ] Validate scanner service, signature/type limits, clean-object immutability, object CORS, orphan cleanup and authorized downloads.
- [ ] Dependency/container scanning, penetration tests, upload abuse tests and tenant/project regression suite complete.
- [ ] CSP and clickjacking controls configured at frontend ingress; accessibility/keyboard/contrast review complete.

## Delivery and operations

- [ ] Protected branches require CI checks; artifact provenance and immutable image digests recorded.
- [ ] Build both Docker images and deploy staging with separate DB/bucket/email credentials.
- [ ] Review and rehearse each migration, locks and forward repair strategy against staging-size data.
- [ ] Verify readiness, liveness, structured logs, trace propagation, exception reporting and service alerts at collector.
- [ ] Alert on failed/stale outbox jobs; test worker restarts and duplicate email behavior.
- [ ] Load-test contention and dashboard/report queries with expected portfolio sizes.
- [ ] Approve RPO/RTO (proposal: 15-minute RPO, 4-hour RTO).
- [ ] Configure encrypted base backups/WAL PITR/object versioning and off-site retention.
- [ ] Restore to isolated infrastructure, reconcile stock/invoices/payments, measure recovery, and archive evidence.
- [ ] Conduct release rollback/forward-fix rehearsal and on-call handover.
- [ ] Obtain explicit business acceptance and release authorization.
