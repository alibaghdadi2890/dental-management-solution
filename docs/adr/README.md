# Architecture Decision Records

One file per decision, numbered, never rewritten once accepted — supersede with a new ADR instead.
Decisions listed in CLAUDE.md §17 predate this log.

| ADR                                                                    | Title                                                                        | Status                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ |
| [0001](0001-clinical-module-owns-visits.md)                            | `clinical` replaces `treatments` and owns visits                             | Accepted                             |
| [0002](0002-procedure-catalog-in-clinical.md)                          | Procedure catalog lives in `clinical`                                        | Accepted (amended by 0015)           |
| [0003](0003-imports-module.md)                                         | `imports` module orchestrates data imports                                   | Accepted                             |
| [0004](0004-platform-admin-tenant-provisioning.md)                     | Tenants are provisioned by platform admins only                              | Accepted (part superseded by 0012)   |
| [0005](0005-toolchain-versions.md)                                     | Toolchain version pins                                                       | Accepted                             |
| [0006](0006-local-s3-seaweedfs.md)                                     | SeaweedFS for local S3-compatible storage                                    | Accepted                             |
| [0007](0007-rooms-in-tenancy.md)                                       | Rooms live in `tenancy`; no chairs                                           | Accepted                             |
| [0008](0008-platform-admin-acting-in-tenant.md)                        | Platform admins act in a tenant via X-Tenant-Id                              | Accepted (amended by 0017)           |
| [0009](0009-identity-module-graph.md)                                  | Identity module graph and `provisioning`                                     | Accepted (amended by 0014)           |
| [0010](0010-permissions-carried-in-cls.md)                             | Permission set carried in the request context                                | Accepted (amended by 0017)           |
| [0011](0011-identity-plane-tables.md)                                  | better-auth tables are a global identity plane                               | Accepted                             |
| [0012](0012-staff-accounts-with-temporary-passwords.md)                | Staff accounts with temporary passwords                                      | Accepted                             |
| [0013](0013-sign-in-lockout-and-session-lifetimes.md)                  | Sign-in lockout and session lifetimes                                        | Accepted                             |
| [0014](0014-consuming-provisioning-events.md)                          | Modules may consume `provisioning`'s events                                  | Accepted                             |
| [0015](0015-catalog-prices-in-tenant-currency.md)                      | Catalog prices in the tenant currency                                        | Accepted (amended by 0035)           |
| [0016](0016-patients-depend-on-users.md)                               | `patients` depends on `users` (primary dentist)                              | Accepted (amended by 0020)           |
| [0017](0017-opening-balances-in-billing.md)                            | Opening balances and patient views in `billing`                              | Accepted (amended by 0024, 0036)     |
| [0018](0018-offset-paging-for-patients.md)                             | Offset paging for the patients list                                          | Accepted (amends CLAUDE.md §12)      |
| [0019](0019-contacts-are-people.md)                                    | Contacts are people; ledgers stay per patient                                | Accepted                             |
| [0020](0020-dentists-referenced-by-staff-profile-id.md)                | Dentists referenced by staff profile id                                      | Accepted (amends 0016)               |
| [0021](0021-canonical-fdi-tooth-codes.md)                              | Canonical FDI codes; chart settings are display-only                         | Accepted                             |
| [0022](0022-records-on-the-tooth-dated-by-visit.md)                    | Clinical records live on the tooth, dated by visit                           | Accepted (amended by 0031)           |
| [0023](0023-live-visit-concurrency.md)                                 | Live-visit concurrency, rooms and discard                                    | Accepted                             |
| [0024](0024-visit-charges-in-the-completion-transaction.md)            | Visit charges in the completion transaction                                  | Accepted                             |
| [0025](0025-visit-amendments-are-append-only-snapshots.md)             | Visit amendments are append-only snapshots                                   | Accepted (amended by 0062)           |
| [0026](0026-billing-vetoes-a-void-in-the-transaction.md)               | Billing vetoes a void inside the transaction                                 | Accepted                             |
| [0027](0027-payments-are-account-level-with-stored-allocations.md)     | Payments are account-level, with stored derived allocations                  | Accepted                             |
| [0028](0028-household-payments.md)                                     | Household payments are one row per account under one receipt                 | Accepted                             |
| [0029](0029-credit-is-applied-immediately.md)                          | Credit is applied immediately                                                | Accepted                             |
| [0030](0030-checkout-discount-is-a-silent-same-day-amendment.md)       | A checkout discount is a silent, same-day amendment                          | Accepted                             |
| [0031](0031-records-without-a-visit.md)                                | Diagnoses and plans may be recorded without a visit                          | Accepted (amends 0022)               |
| [0032](0032-multi-visit-work-is-charged-when-done.md)                  | Work over several visits is charged when it is done                          | Accepted                             |
| [0033](0033-closing-a-checkout-without-a-payment-is-stored.md)         | Closing a checkout without a payment is stored on the visit                  | Accepted (amends 0030)               |
| [0034](0034-tooth-presence-is-a-history-on-the-tooth.md)               | Tooth presence is a history on the tooth                                     | Accepted                             |
| [0035](0035-the-tenant-currency-locks-at-the-first-ledger-entry.md)    | The tenant currency locks at the first ledger entry                          | Accepted (amends 0015)               |
| [0036](0036-the-ledger-follows-a-merge-in-its-transaction.md)          | The ledger follows a patient merge in its transaction                        | Accepted (amends 0017)               |
| [0037](0037-the-audit-log-knows-what-a-row-is-about.md)                | The audit log records what a row is about                                    | Accepted (amends CLAUDE.md §10, §12) |
| [0038](0038-files-belong-to-the-patient.md)                            | Files belong to the patient, with optional visit and tooth                   | Accepted (amends CLAUDE.md §4)       |
| [0039](0039-file-originals-are-immutable.md)                           | Originals are immutable; previews are made in the browser                    | Accepted (amended by 0041)           |
| [0040](0040-files-are-archived-never-deleted.md)                       | Files are archived, never deleted                                            | Accepted                             |
| [0041](0041-save-seals-a-files-objects.md)                             | Save seals a file's objects and checks the sealed copies                     | Accepted (amends 0039, CLAUDE.md §9) |
| [0042](0042-chart-marks-live-on-catalog-items.md)                      | Chart marks live on catalog items and recolour retroactively                 | Accepted                             |
| [0043](0043-chart-view-is-a-browser-preference.md)                     | The chart view is a browser preference; the mode is tenant's                 | Accepted                             |
| [0044](0044-visit-types-and-the-derived-step-model.md)                 | A visit has a type; its steps are derived, one step stored                   | Accepted                             |
| [0045](0045-priority-is-the-phase-of-the-treatment-plan.md)            | Priority is the plan's phase; named plan groups are retired                  | Accepted                             |
| [0046](0046-structured-medical-history-confirmed-per-visit.md)         | Medical history is structured and confirmed per visit                        | Accepted                             |
| [0047](0047-a-service-can-be-added-on-a-visit-type.md)                 | A catalog service can be added on visits of one type                         | Accepted                             |
| [0048](0048-the-worklist-replaces-the-unfinished-prompt.md)            | A treatment visit keeps a list of planned work for today                     | Accepted (amends 0032)               |
| [0049](0049-a-diagnosis-cites-what-it-was-seen-on.md)                  | A diagnosis cites an image; `files` vetoes in the transaction                | Accepted                             |
| [0051](0051-advance-payments-are-held-for-the-treatment-plan.md)       | An advance payment is held for the treatment plan                            | Accepted (amends 0029)               |
| [0052](0052-phones-are-optional-and-kept-as-typed.md)                  | A phone is optional and kept as typed; the record says what is missing       | Accepted (supersedes C3, C10)        |
| [0053](0053-imports-write-through-services-and-never-charge-visits.md) | Imports write through the owning services; imported visits are never charged | Accepted                             |
| [0054](0054-a-service-icon-is-drawn-inside-the-tooth.md)               | A service icon is drawn inside the tooth; a service may have no colour       | Accepted (amends 0042)               |
| [0055](0055-permissions-from-roles-and-grants.md)                      | Permissions from roles and grants; money tiers, visit scope, discounts       | Accepted (amends 0008, 0010, 0030)   |
| [0056](0056-platform-default-roles.md)                                 | The platform manages default roles and, for a clinic, its roles              | Accepted (amends 0055)               |
| [0057](0057-platform-activity-across-clinics.md)                       | Platform admins see the Activity of every clinic                             | Accepted                             |
| [0058](0058-agreements-are-effective-dated-component-sets.md)          | A dentist's compensation agreement is an effective-dated set of components   | Accepted                             |
| [0059](0059-statements-are-derived-and-frozen-on-close.md)             | A dentist's statement is derived for open months and frozen on close         | Accepted (amended by 0062)           |
| [0060](0060-compensation-is-clinic-managed-only.md)                    | Compensation is managed by the clinic only                                   | Accepted (amends 0055, 0057)         |
| [0061](0061-admin-system-role.md)                                      | An Admin system role with every permission, below the owner                  | Accepted (amends 0055, 0056)         |
| [0062](0062-correcting-a-finished-visit.md)                            | Correcting a finished visit: services, prices and times                      | Accepted (amended by 0063)           |
| [0063](0063-a-correction-may-move-a-visit-to-another-day.md)           | A correction may move a visit to another day                                 | Accepted                             |
