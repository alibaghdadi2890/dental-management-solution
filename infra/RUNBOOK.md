# Operations runbook — the clinic app on its Lightsail box

One Lightsail box in `eu-west-3` (`dcm-dev`), five containers, no orchestrator, behind
Cloudflare at **https://dental.mahdibaghdadi.com**. Everything here runs from a laptop
that has the studio checkout (`~/dev/mhdb-studio`), the `mhdb-hosting` AWS profile, `~/.ssh/dcm`
and `~/.secrets/dcm-*`.

## Topology

```
[Browser] ──HTTPS──▶ [Cloudflare edge] ──HTTP──▶ [Lightsail :80, Cloudflare's ranges only]
                        │
       nginx (web container) ─────┤
         ├── /api/*     → api:3000          NestJS (cookie sessions, same origin)
         ├── /health/*  → api:3000
         ├── /dcm/*     → s3:8333           the bucket's path: presigned uploads/downloads
         └── /          → the SPA (static)
                        │
       postgres:17 · redis:7 · seaweedfs (S3) — compose network only
```

- **TLS ends at Cloudflare** (a proxied A record on the studio's `mahdibaghdadi.com` zone, in
  Flexible mode like the studio's other boxes). The session cookie is `Secure`. nginx sends plain
  HTTP to HTTPS, and takes the client address from `CF-Connecting-IP`, but only from Cloudflare's
  ranges. The hop from Cloudflare to the box is plain HTTP; `infra/erp/README.md` in the studio
  tracks origin TLS as a fleet-wide follow-up.
- **`:22`** accepts SSH from anywhere, key-only (`~/.ssh/dcm`; password auth is off on the
  Ubuntu blueprint). **`:80`** accepts Cloudflare's ranges only (`WEB_ACCESS=cloudflare` in
  `infra/lightsail.env`; `start.sh` reapplies it), so the bare IP does not serve the app.
- **State on the box's disk:** `/var/lib/dcm/postgres-data`, `/var/lib/dcm/redis` (BullMQ),
  `/var/lib/dcm/s3` (the files). `/var/backups/dcm` holds the nightly local backups.
- **No git and no source on the box.** `/opt/dcm` holds `docker-compose.yml`, `.env`, `s3.json`,
  `seaweedfs-start.sh`, `postgres-init/` and `backup.sh`, all written by `infra/scripts/ship.sh`.
- **The address is configuration.** `.env` carries `PUBLIC_ORIGIN` (`https://` + `DOMAIN` from
  `infra/lightsail.env`): the origin better-auth trusts (`AUTH_BASE_URL`) and the address the API
  signs object-store URLs for (`S3_PUBLIC_ENDPOINT`). The API itself reaches the store as
  `http://s3:8333`. Without a `DOMAIN` the scripts fall back to the bare IP over plain HTTP.

Names: instance `dcm-dev`, static IP `dcm-dev-ip`, key pair `dcm-dev-deploy`, images `dcm-api:<sha>`
and `dcm-web:<sha>` (loaded on the box, no registry), AWS profile `mhdb-hosting`.

## Deploy (a push to main does it)

Every push to `main` deploys by itself once CI passes on it: `.github/workflows/deploy.yml` finds the
box, builds both images on GitHub's runner (free: the repo is public), copies the non-secret files,
streams the images over SSH, migrates and restarts, then checks `/health/ready` from outside. The run
summary names the address. Actions → **Deploy** → **Run workflow** deploys `main` by hand, for example
after the box was started again.

No secret is set in this repo. The workflow assumes the AWS role `dcm-deploy`, which trusts only
this repo's `main` and may only find the box and read its deploy key from AWS Parameter Store
(`/dcm/deploy-ssh-key`; the public half is on the box). It cannot start, stop or change the box,
and it never touches `.env`: secrets still change through `ship.sh config` (see **Configuration**).
While the box is parked, Deploy does nothing and says so. Made by the studio's
`infra/erp/scripts/setup-deploy-role.sh`; to rotate the key, generate a new `~/.ssh/dcm-ci`, run
that script and `ship.sh config` (and remove the old line from the box's `authorized_keys`).

## Shipping by hand (`infra/scripts/ship.sh`)

| Command                     | What it does                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ship.sh config`            | Looks the box's IP up, writes `/opt/dcm/.env` (secrets from `~/.secrets/dcm-*`) and `s3.json`, then runs `files`; installs CI's public deploy key                                                                                                                                                 |
| `ship.sh files`             | The non-secret files only: the compose file, the Postgres role init, the store's start script, `on-boot.sh` and its unit; validates the compose file on the box. Deploy runs it every time                                                                                                        |
| `ship.sh push-images <tag>` | Streams `dcm-api:<tag>` and `dcm-web:<tag>` from this machine's Docker into the box's and sets them in `.env`. Deploy runs it every time                                                                                                                                                          |
| `ship.sh load [<run>]`      | Starts the `image` workflow on `main` (or takes run `<run>`'s artifact), has the box download and `docker load` both images, deletes the artifact, sets `API_IMAGE`/`WEB_IMAGE` in `.env`. Refuses a commit whose CI did not succeed; `CI_GATE=off` overrides, `DCM_REF=<branch>` builds a branch |
| `ship.sh up`                | Starts the stores, applies the migrations as the schema owner (`node dist/cli/migrate.js`), starts the stack, waits for `/health/ready`                                                                                                                                                           |
| `ship.sh admin <email>`     | Creates (or promotes) the platform admin with the password in `~/.secrets/dcm-platform-admin-password`                                                                                                                                                                                            |
| `ship.sh status`            | `free -m`, `docker stats`, the containers, disk                                                                                                                                                                                                                                                   |
| `ship.sh backup`            | Installs the nightly local backup (cron 00:00 UTC) and runs it once                                                                                                                                                                                                                               |

Order on a fresh box: `config`, `load`, `up`, `admin`, `backup`. A code change: a push to `main`.
A configuration change: see **Configuration** below.

## Configuration (where every variable lives)

The API reads its configuration from the container's environment only
(`apps/api/src/platform/config/config.schema.ts` validates it at boot). On the box that
environment comes from two files in `/opt/dcm`:

| File on the box               | Holds                                                                                                                                                        | Written by                                                                                | To change                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/opt/dcm/.env` (0600)        | the secrets (`POSTGRES_PASSWORD`, `DCM_APP_PASSWORD`, `DCM_ADMIN_PASSWORD`, `AUTH_SECRET`, `S3_SECRET_ACCESS_KEY`), `PUBLIC_IP`, `LOG_LEVEL`, the image tags | `ship.sh config`, from `~/.secrets/dcm-*` on the laptop; `PUBLIC_IP` also by `on-boot.sh` | a secret: edit `~/.secrets/dcm-<name>`, then `ship.sh config` and `ship.sh up` (a Postgres role password needs `ALTER ROLE` first). Never edit `.env` on the box by hand: the next `config` overwrites it |
| `/opt/dcm/docker-compose.yml` | everything that is not secret: database URLs, `REDIS_URL`, the store endpoints, `AUTH_BASE_URL`, `AUTH_COOKIE_SECURE`, `OTEL_*`, pool size, memory caps      | Deploy (and `ship.sh files`), from `infra/compose/docker-compose.yml`                     | edit the file in this repo and push to `main`: Deploy ships it once CI passes                                                                                                                             |
| `/opt/dcm/s3.json` (0600)     | the store's access key and secret                                                                                                                            | `ship.sh config`                                                                          | as a secret above (`~/.secrets/dcm-s3-secret`)                                                                                                                                                            |

The variables themselves are listed with their meaning in `apps/api/.env.example`.

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
firewall from `lightsail.env`. **After a Start, point `dental.mahdibaghdadi.com`'s A record
(Cloudflare, proxied) at the new IP**, which is in the run summary; until then the domain answers
with a Cloudflare error. The box records the new IP in `.env` itself at boot
(`infra/scripts/on-boot.sh`), and the app's address stays the domain, so nothing else changes.
The parked snapshot is also the off-box backup.

The same two operations run as GitHub Actions workflows in the studio's repo,
`mahdibaghdadi/mhdb-studio` → Actions → **dcm: Shut down** (type `shutdown` to confirm) and
**dcm: Start** (the new address is in the run summary). They live there, not here, because this
repo cannot use the studio's private actions and its secrets are not the studio's to set.

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

## Sizing (measured 2026-10-14 on nano_3_0; the box is micro_3_0 since 2026-10-15)

`nano_3_0`: 2 vCPU, 512 MB (412 MB usable), 20 GB SSD, the 2 GB swap file the studio bootstrap
adds. The compose ceilings (`mem_limit`) are caps, not reservations: web 32, api 320, postgres 160,
redis 64, s3 160 MB.

| Moment                                     | used | available | swap used |
| ------------------------------------------ | ---- | --------- | --------- |
| After the bootstrap, no containers         | 245  | 167       | 43        |
| Stack up, after the end-to-end upload test | 259  | 152       | 295       |

Container RSS at that second moment: api 34 MB, s3 22, postgres 11, redis 3, web 3 (most of the
API's heap is paged out between requests). No OOM kill in `dmesg`. From a laptop, the first
requests after a start take 0.6–1.2 s (pages come back from swap), then `/`, `/api/v1/session`
and `/health/ready` settle at about 120–130 ms. Disk: 39 % after the five images.

Timings: the `image` workflow 1 min 16 s (one 184 MB artifact for both images), `ship.sh load`
59 s, `ship.sh up` 1 min 21 s (stores, migrations, stack), the box's first boot about 4 min.

The box ran, but on swap, and it felt slow, so on 2026-10-15 it moved to `micro_3_0` (park, then
start with `BUNDLE=micro_3_0`; 7 min 20 s down, new IP):

| `micro_3_0`, 2026-10-15, stack just up | used | available | swap used |
| -------------------------------------- | ---- | --------- | --------- |
| 1 GB (909 MB usable), 40 GB disk       | 531  | 377       | 104       |

Container RSS: api 122 MB (its heap now stays in memory), s3 67, postgres 18, redis 2, web 2. The
root filesystem grew to the bundle's 38 GB by itself (23 % used). From a laptop, `/api/v1/session`
and `/health/ready` answer in 110–125 ms from the first request. Next step up, if ever needed:
`small_3_0` (2 GB, $12/month), the same way.
