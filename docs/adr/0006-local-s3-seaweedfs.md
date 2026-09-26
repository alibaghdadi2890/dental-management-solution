# ADR-0006: SeaweedFS for local S3-compatible storage

- Status: Accepted
- Date: 2026-09-26

## Context

CLAUDE.md §15 named MinIO for local development. MinIO no longer distributes community container
images: `minio/minio` on Docker Hub (including pinned release tags) and `quay.io/minio/minio` are
not pullable. Production storage is any S3-compatible service and is unaffected.

## Decision

Docker Compose runs SeaweedFS (`chrislusf/seaweedfs`, Apache-2.0) with its S3 gateway on port
8333, static credentials from `docker/seaweedfs/s3.json`, and a one-shot service that creates the
`dcm-local` bucket. The API talks to it through the AWS SDK with path-style addressing, exactly as
it would to any S3 endpoint.

## Consequences

- No code depends on SeaweedFS; switching to another S3-compatible server is a Compose change.
- CLAUDE.md §15 updated.
