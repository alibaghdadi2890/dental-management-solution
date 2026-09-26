# Architecture Decision Records

One file per decision, numbered, never rewritten once accepted — supersede with a new ADR instead.
Decisions listed in CLAUDE.md §17 predate this log.

| ADR                                                   | Title                                            | Status   |
| ----------------------------------------------------- | ------------------------------------------------ | -------- |
| [0001](0001-clinical-module-owns-visits.md)           | `clinical` replaces `treatments` and owns visits | Accepted |
| [0002](0002-procedure-catalog-in-clinical.md)         | Procedure catalog lives in `clinical`            | Accepted |
| [0003](0003-imports-module.md)                        | `imports` module orchestrates data imports       | Accepted |
| [0004](0004-platform-admin-tenant-provisioning.md)    | Tenants are provisioned by platform admins only  | Accepted |
| [0005](0005-toolchain-versions.md)                    | Toolchain version pins                           | Accepted |
| [0006](0006-local-s3-seaweedfs.md)                    | SeaweedFS for local S3-compatible storage        | Accepted |
| [0007](0007-rooms-in-tenancy.md)                      | Rooms live in `tenancy`; no chairs               | Accepted |
| [0008](0008-platform-admin-acting-in-tenant.md)       | Platform admins act in a tenant via X-Tenant-Id  | Accepted |
| [0009](0009-identity-module-graph.md)                 | Identity module graph and `provisioning`         | Accepted |
| [0010](0010-permissions-carried-in-cls.md)            | Permission set carried in the request context    | Accepted |
| [0011](0011-identity-plane-tables.md)                 | better-auth tables are a global identity plane   | Accepted |
| [0013](0013-sign-in-lockout-and-session-lifetimes.md) | Sign-in lockout and session lifetimes            | Accepted |
