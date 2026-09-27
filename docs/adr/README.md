# Architecture Decision Records

One file per decision, numbered, never rewritten once accepted — supersede with a new ADR instead.
Decisions listed in CLAUDE.md §17 predate this log.

| ADR                                                     | Title                                            | Status                             |
| ------------------------------------------------------- | ------------------------------------------------ | ---------------------------------- |
| [0001](0001-clinical-module-owns-visits.md)             | `clinical` replaces `treatments` and owns visits | Accepted                           |
| [0002](0002-procedure-catalog-in-clinical.md)           | Procedure catalog lives in `clinical`            | Accepted (amended by 0015)         |
| [0003](0003-imports-module.md)                          | `imports` module orchestrates data imports       | Accepted                           |
| [0004](0004-platform-admin-tenant-provisioning.md)      | Tenants are provisioned by platform admins only  | Accepted (part superseded by 0012) |
| [0005](0005-toolchain-versions.md)                      | Toolchain version pins                           | Accepted                           |
| [0006](0006-local-s3-seaweedfs.md)                      | SeaweedFS for local S3-compatible storage        | Accepted                           |
| [0007](0007-rooms-in-tenancy.md)                        | Rooms live in `tenancy`; no chairs               | Accepted                           |
| [0008](0008-platform-admin-acting-in-tenant.md)         | Platform admins act in a tenant via X-Tenant-Id  | Accepted (amended by 0017)         |
| [0009](0009-identity-module-graph.md)                   | Identity module graph and `provisioning`         | Accepted (amended by 0014)         |
| [0010](0010-permissions-carried-in-cls.md)              | Permission set carried in the request context    | Accepted (amended by 0017)         |
| [0011](0011-identity-plane-tables.md)                   | better-auth tables are a global identity plane   | Accepted                           |
| [0012](0012-staff-accounts-with-temporary-passwords.md) | Staff accounts with temporary passwords          | Accepted                           |
| [0013](0013-sign-in-lockout-and-session-lifetimes.md)   | Sign-in lockout and session lifetimes            | Accepted                           |
| [0014](0014-consuming-provisioning-events.md)           | Modules may consume `provisioning`'s events      | Accepted                           |
| [0015](0015-catalog-prices-in-tenant-currency.md)       | Catalog prices in the tenant currency            | Accepted                           |
| [0016](0016-patients-depend-on-users.md)                | `patients` depends on `users` (primary dentist)  | Accepted                           |
| [0017](0017-opening-balances-in-billing.md)             | Opening balances and patient views in `billing`  | Accepted                           |
| [0018](0018-offset-paging-for-patients.md)              | Offset paging for the patients list              | Accepted (amends CLAUDE.md §12)    |
