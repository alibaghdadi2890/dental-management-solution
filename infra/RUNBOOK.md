# Operations runbook — the clinic app on its Lightsail box

One Lightsail box in `eu-west-3` (`dcm-dev`), five containers, no orchestrator, no domain:
the app is served on the box's public IP over plain HTTP. Everything here runs from a laptop
that has the studio checkout (`~/dev/mhdb-studio`), the `mhdb-hosting` AWS profile, `~/.ssh/dcm`
and `~/.secrets/dcm-*`.

## Topology

```
[Browser] ──HTTP──▶ [Lightsail :80, open to everyone]
                        │
       nginx (web container) ─────┤
         ├── /api/*     → api:3000          NestJS (cookie sessions, same origin)
         ├── /health/*  → api:3000
         ├── /dcm/*     → s3:8333           the bucket's path: presigned uploads/downloads
         └── /          → the SPA (static)
                        │
       postgres:17 · redis:7 · seaweedfs (S3) — compose network only
```

- **No TLS.** The browser talks plain HTTP to the box, so the session cookie is not `Secure`
  (`AUTH_COOKIE_SECURE=false`) and everything crosses the internet in clear. This is a staging
  posture. Before real patients: a domain on Cloudflare (see the studio's `infra/erp/README.md`).
- **`:22`** accepts SSH from anywhere, key-only (`~/.ssh/dcm`; password auth is off on the
  Ubuntu blueprint). **`:80`** is open to everyone (`public_web` in the studio root,
  `WEB_ACCESS=public` in `infra/lightsail.env`).
- **State on the box's disk:** `/var/lib/dcm/postgres-data`, `/var/lib/dcm/redis` (BullMQ),
  `/var/lib/dcm/s3` (the files). `/var/backups/dcm` holds the nightly local backups.
- **No git and no source on the box.** `/opt/dcm` holds `docker-compose.yml`, `.env`, `s3.json`,
  `seaweedfs-start.sh`, `postgres-init/` and `backup.sh`, all written by `infra/scripts/ship.sh`.
- **The IP is configuration.** `.env` carries `PUBLIC_IP`: the origin better-auth trusts
  (`AUTH_BASE_URL`) and the address the API signs object-store URLs for (`S3_PUBLIC_ENDPOINT`).
  The API itself reaches the store as `http://s3:8333`.

Names: instance `dcm-dev`, static IP `dcm-dev-ip`, key pair `dcm-dev-deploy`, images `dcm-api:<sha>`
and `dcm-web:<sha>` (loaded on the box, no registry), AWS profile `mhdb-hosting`.

## Shipping (`infra/scripts/ship.sh`)

| Command                 | What it does                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ship.sh config`        | Looks the box's IP up, writes `/opt/dcm/.env` (secrets from `~/.secrets/dcm-*`), `s3.json`, the compose file, the Postgres role init and the store's start script; validates the compose file on the box |
| `ship.sh load [<run>]`  | Starts the `image` workflow on `main` (or takes run `<run>`'s artifact), has the box download and `docker load` both images, deletes the artifact, sets `API_IMAGE`/`WEB_IMAGE` in `.env`. Refuses a commit whose CI did not succeed; `CI_GATE=off` overrides, `DCM_REF=<branch>` builds a branch |
| `ship.sh up`            | Starts the stores, applies the migrations as the schema owner (`node dist/cli/migrate.js`), starts the stack, waits for `/health/ready` |
| `ship.sh admin <email>` | Creates (or promotes) the platform admin with the password in `~/.secrets/dcm-platform-admin-password` |
| `ship.sh status`        | `free -m`, `docker stats`, the containers, disk                                                                 |
| `ship.sh backup`        | Installs the nightly local backup (cron 00:00 UTC) and runs it once                                             |

Order on a fresh box: `config`, `load`, `up`, `admin`, `backup`. A code change: `load`, `up`.
A secret change: edit `~/.secrets/dcm-*`, then `config`, `up` (a Postgres role password also
needs `ALTER ROLE` first: the init script runs only on an empty data dir).

## First-time bootstrap

1. `ssh-keygen -t ed25519 -N '' -f ~/.ssh/dcm`; six secrets, `openssl rand -hex 24 > ~/.secrets/dcm-<name>`,
   `chmod 600`: `postgres-password`, `app-password`, `admin-password` (the three Postgres roles),
   `auth-secret`, `s3-secret`, `platform-admin-password`.
2. The box: `cd ~/dev/mhdb-studio/infra/erp/dcm && tofu init && tofu apply` (module
   `infra/modules/lightsail-erp`). Wait for `/var/log/dcm-bootstrap.log` to end in
   `bootstrap completed` (about four minutes: Docker, a 2 GB swap file, the `deploy` user).
3. `infra/scripts/ship.sh config && ship.sh load && ship.sh up && ship.sh admin <email> && ship.sh backup`.
4. Sign in at `http://<ip>/login` as the platform admin and provision the first clinic under
   **Platform › Tenants**.

## Park and start (save cost while unused)

From this repo's root, with the studio's shared scripts:

```sh
AWS_PROFILE=mhdb-hosting ~/dev/mhdb-studio/infra/erp/scripts/park.sh  infra/lightsail.env
AWS_PROFILE=mhdb-hosting ~/dev/mhdb-studio/infra/erp/scripts/start.sh infra/lightsail.env
```

Park stops the box, snapshots it (`dcm-dev-parked-<UTC>`, the one kept), deletes the instance
and releases the IP. Start recreates it from the snapshot with a **new IP** and reopens the
firewall from `lightsail.env`. The app then needs the new address: `ship.sh config`, then
`ship.sh up`. The parked snapshot is also the off-box backup.

To grow the box (the snapshot restores into a larger bundle, never a smaller one): park, set
`BUNDLE=micro_3_0` in `infra/lightsail.env` (and `bundle_id` in the studio root, for the record),
start.

Never `tofu apply` the studio root against a live or parked box without `tofu import` first:
park/start own the box after its creation.

## Everyday operations

```sh
SSH="ssh -i ~/.ssh/dcm deploy@$(AWS_PROFILE=mhdb-hosting ~/dev/mhdb-studio/infra/erp/scripts/find-host.sh infra/lightsail.env)"
$SSH 'cd /opt/dcm && docker compose ps'
$SSH 'cd /opt/dcm && docker compose logs --tail 100 -f api'
$SSH 'cd /opt/dcm && docker compose exec postgres psql -U dcm_owner -d dcm'
$SSH 'cd /opt/dcm && docker compose restart api'
```

**Rollback:** the box keeps the previous image pair. `ship.sh load <run>` with an earlier image
run, or on the box set `API_IMAGE`/`WEB_IMAGE` in `.env` to the previous tags and
`docker compose up -d`. Migrations are forward-only: a rollback across a migration needs a restore.

**Restore a backup** (`/var/backups/dcm/dcm-<stamp>.dump` and `.s3.tgz`):

```sh
cd /opt/dcm && docker compose stop api web
docker compose exec -T postgres psql -U dcm_owner -d postgres -c 'DROP DATABASE dcm' -c 'CREATE DATABASE dcm'
docker compose exec -T postgres pg_restore -U dcm_owner -d dcm --no-owner < /var/backups/dcm/dcm-<stamp>.dump
docker compose exec -T postgres psql -U dcm_owner -d dcm -c 'GRANT USAGE ON SCHEMA public TO dcm_app, dcm_admin' \
  -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dcm_app, dcm_admin' \
  -c 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dcm_app, dcm_admin'
docker compose stop s3 && sudo rm -rf /var/lib/dcm/s3/* && sudo tar -C /var/lib/dcm -xzf /var/backups/dcm/dcm-<stamp>.s3.tgz
docker compose up -d
```

(The dump is taken with `--no-owner`, so the grants the migrations gave the runtime roles are
re-applied by hand; the append-only tables' revokes live in the migrations too and are not
re-applied by this recipe. Rehearse before relying on it.)

## Sizing (measured 2026-10-14, the first deploy)

`nano_3_0`: 2 vCPU, 512 MB (412 MB usable), 20 GB SSD, the 2 GB swap file the studio bootstrap
adds. The compose ceilings (`mem_limit`) are caps, not reservations: web 32, api 320, postgres 160,
redis 64, s3 160 MB.

| Moment                                         | used | available | swap used |
| ---------------------------------------------- | ---- | --------- | --------- |
| After the bootstrap, no containers             | 245  | 167       | 43        |
| Stack up, after the end-to-end upload test     | 259  | 152       | 295       |

Container RSS at that second moment: api 34 MB, s3 22, postgres 11, redis 3, web 3 (most of the
API's heap is paged out between requests). No OOM kill in `dmesg`. From a laptop, the first
requests after a start take 0.6–1.2 s (pages come back from swap), then `/`, `/api/v1/session`
and `/health/ready` settle at about 120–130 ms. Disk: 39 % after the five images.

Timings: the `image` workflow 1 min 16 s (one 184 MB artifact for both images), `ship.sh load`
59 s, `ship.sh up` 1 min 21 s (stores, migrations, stack), the box's first boot about 4 min.

The box runs, but on swap. If `ship.sh status` shows swap climbing past ~500 MB, requests staying
slow once warm, or an OOM kill: park, `BUNDLE=micro_3_0` (1 GB, $7/month), start.
