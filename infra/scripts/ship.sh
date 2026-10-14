#!/usr/bin/env bash
# Ship the clinic app to its Lightsail box FROM A LAPTOP that has the studio checkout (mhdb-studio) and
# the mhdb-hosting AWS profile. Secrets are read from ~/.secrets at the moment of use and never printed.
#   ship.sh config         compose file, object-store config, Postgres role init and /opt/dcm/.env, from the box's current IP
#   ship.sh load [<run>]   build with the "image" workflow (or take run <run>'s images), load them on the box, delete the artifact;
#                          refuses a commit whose CI did not succeed, and waits for a CI run still going
#   ship.sh up             apply the migrations, start / update the stack, wait until it answers
#   ship.sh admin <email>  create (or promote) the platform admin; password from ~/.secrets/dcm-platform-admin-password
#   ship.sh status         memory, containers, disk
#   ship.sh backup         install the nightly local backup (pg_dump + the object store) and run it once
# Needs: ~/.ssh/dcm; ~/.secrets/dcm-{postgres-password,app-password,admin-password,auth-secret,s3-secret,platform-admin-password}.
# Order on a fresh box: config, load, up, admin. After a Start the box adopts its new IP by itself (on-boot.sh).
# DCM_HOST=<ip> skips the lookup of the box's address; DCM_REF=<branch> builds that branch instead of main;
# CI_GATE=off ships a commit whose CI did not pass (say why in the run's notes).
set -euo pipefail

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; }
case "${1:-}" in config | load | up | admin | status | backup) ;; *) usage; exit 1 ;; esac

HERE="$(cd "$(dirname "$0")/.." && pwd)"          # infra/
ROOT="$(cd "$HERE/.." && pwd)"                      # the repo
STUDIO="${STUDIO_DIR:-$HOME/dev/mhdb-studio}"
REPO="alibaghdadi2890/dental-management-solution"
REF="${DCM_REF:-main}"
S=~/.secrets
HOST="${DCM_HOST:-$(AWS_PROFILE=mhdb-hosting "$STUDIO/infra/erp/scripts/find-host.sh" "$HERE/lightsail.env")}"
[ -n "$HOST" ] || { echo "the box is parked (no instance): start it first (mhdb-studio/infra/erp/scripts/start.sh)" >&2; exit 1; }
SSH=(ssh -i "$HOME/.ssh/dcm" -o StrictHostKeyChecking=accept-new "deploy@$HOST")
SCP=(scp -q -i "$HOME/.ssh/dcm" -o StrictHostKeyChecking=accept-new)
TMP_ENV="" TMP_S3="" HDR_FILE=""
trap '[ -z "$TMP_ENV" ] || rm -f "$TMP_ENV"; [ -z "$TMP_S3" ] || rm -f "$TMP_S3"; [ -z "$HDR_FILE" ] || rm -f "$HDR_FILE"' EXIT

# A secret file's content, or a stop naming the file when it is missing or empty.
secret() { [ -s "$S/$1" ] || { echo "missing or empty: $S/$1" >&2; exit 1; }; cat "$S/$1"; }

# umask 077 first: .env.next holds every secret, so it must never exist world-readable, not even until the chmod.
set_env() { "${SSH[@]}" "cd /opt/dcm && umask 077 && { grep -v '^$1=' .env; echo '$1=$2'; } > .env.next && mv .env.next .env && chmod 600 .env"; }

config() {
  local pg app adm auth s3 api_image web_image
  pg="$(secret dcm-postgres-password)"; app="$(secret dcm-app-password)"; adm="$(secret dcm-admin-password)"
  auth="$(secret dcm-auth-secret)"; s3="$(secret dcm-s3-secret)"
  # Keep the image tags the box already runs, unless this run sets new ones.
  api_image="${API_IMAGE:-$("${SSH[@]}" "grep -s '^API_IMAGE=' /opt/dcm/.env | cut -d= -f2-")}"
  web_image="${WEB_IMAGE:-$("${SSH[@]}" "grep -s '^WEB_IMAGE=' /opt/dcm/.env | cut -d= -f2-")}"

  TMP_ENV="$(umask 077; mktemp)"
  {
    echo "# Written by infra/scripts/ship.sh config. Secrets: edit ~/.secrets on the laptop and ship again."
    echo "PUBLIC_IP=$HOST"
    echo "POSTGRES_PASSWORD=$pg"
    echo "DCM_APP_PASSWORD=$app"
    echo "DCM_ADMIN_PASSWORD=$adm"
    echo "AUTH_SECRET=$auth"
    echo "S3_ACCESS_KEY_ID=dcm"
    echo "S3_SECRET_ACCESS_KEY=$s3"
    echo "LOG_LEVEL=info"
    echo "API_IMAGE=${api_image:-dcm-api:latest}"
    echo "WEB_IMAGE=${web_image:-dcm-web:latest}"
  } >"$TMP_ENV"
  TMP_S3="$(umask 077; mktemp)"
  printf '{ "identities": [ { "name": "dcm", "credentials": [ { "accessKey": "dcm", "secretKey": "%s" } ], "actions": ["Admin", "Read", "List", "Tagging", "Write"] } ] }\n' "$s3" >"$TMP_S3"

  "${SSH[@]}" "sudo install -d -m 0755 -o deploy -g deploy /opt/dcm /opt/dcm/postgres-init /var/lib/dcm/redis /var/lib/dcm/s3 /var/backups/dcm"
  "${SCP[@]}" "$HERE/compose/docker-compose.yml" "deploy@$HOST:/opt/dcm/docker-compose.yml"
  "${SCP[@]}" "$HERE/compose/postgres-init/01-roles.sh" "deploy@$HOST:/opt/dcm/postgres-init/01-roles.sh"
  "${SCP[@]}" "$HERE/compose/seaweedfs-start.sh" "deploy@$HOST:/opt/dcm/seaweedfs-start.sh"
  "${SCP[@]}" "$TMP_ENV" "deploy@$HOST:/opt/dcm/.env"
  "${SCP[@]}" "$TMP_S3" "deploy@$HOST:/opt/dcm/s3.json"
  "${SCP[@]}" "$HERE/scripts/on-boot.sh" "deploy@$HOST:/opt/dcm/on-boot.sh"
  "${SSH[@]}" "chmod 600 /opt/dcm/.env /opt/dcm/s3.json && chmod +x /opt/dcm/postgres-init/01-roles.sh /opt/dcm/seaweedfs-start.sh /opt/dcm/on-boot.sh \
    && cd /opt/dcm && docker compose config -q && echo 'config shipped and valid (PUBLIC_IP=$HOST)'"
  # At every boot the box checks its public IP and rewrites PUBLIC_IP when a Start changed it (on-boot.sh).
  "${SSH[@]}" "printf '%s\n' '[Unit]' 'Description=dcm: adopt the box public IP into /opt/dcm/.env' 'After=docker.service' 'Requires=docker.service' '' \
    '[Service]' 'Type=oneshot' 'User=deploy' 'ExecStart=/opt/dcm/on-boot.sh' '' '[Install]' 'WantedBy=multi-user.target' \
    | sudo tee /etc/systemd/system/dcm-boot.service >/dev/null && sudo systemctl daemon-reload && sudo systemctl enable -q dcm-boot.service && echo 'dcm-boot.service installed'"
}

# wait_run <run id>: until that workflow run has completed (30 minutes at most).
wait_run() {
  local status
  for _ in $(seq 1 180); do
    status="$(gh run view "$1" -R "$REPO" --json status -q .status)"
    [ "$status" = completed ] && return 0
    sleep 10
  done
  echo "run $1 did not complete within 30 minutes" >&2; exit 1
}

# build_ref <full sha>: starts the image workflow on REF, waits for it and prints its run id.
# Refuses when the run built another commit (the branch moved on meanwhile) or failed.
build_ref() {
  local full="$1" before run="" built
  before="$(gh run list -R "$REPO" -w image -L 1 --json databaseId -q '.[0].databaseId // 0')"
  gh workflow run image -R "$REPO" --ref "$REF" >/dev/null
  # The new run takes a few seconds to appear; run ids only grow.
  for _ in $(seq 1 30); do
    run="$(gh run list -R "$REPO" -w image -e workflow_dispatch -L 1 --json databaseId -q ".[0].databaseId | select(. > $before)")"
    [ -n "$run" ] && break
    sleep 2
  done
  [ -n "$run" ] || { echo "the image run did not appear" >&2; exit 1; }
  echo "building dcm-{api,web}:${full:0:7} from $REF (image run $run, about 4–6 minutes)" >&2
  wait_run "$run"
  built="$(gh run view "$run" -R "$REPO" --json conclusion,headSha -q '"\(.conclusion) \(.headSha)"')"
  [ "$built" = "success $full" ] || { echo "image run $run: $built, wanted success $full" >&2; exit 1; }
  echo "$run"
}

load() {
  local run="${1:-}" full
  if [ -n "$run" ]; then
    full="$(gh run view "$run" -R "$REPO" --json headSha -q .headSha)"
    [ -n "$full" ] || { echo "run $run not found in $REPO"; exit 1; }
  else
    full="$(gh api "repos/$REPO/commits/$REF" -q .sha)"
  fi
  local sha="${full:0:7}"
  # image.yml does not wait for ci.yml, so an image can exist for a commit whose tests fail: ship a
  # commit only when the CI run for that exact commit concluded success. A run still going is waited for.
  if [ "${CI_GATE:-on}" != off ]; then
    local pending ci
    pending="$(gh run list -R "$REPO" -w ci.yml --commit "$full" --json databaseId,status -q '.[0] // empty | select(.status != "completed") | .databaseId')"
    [ -z "$pending" ] || { echo "waiting for CI on $sha (run $pending)" >&2; wait_run "$pending"; }
    ci="$(gh run list -R "$REPO" -w ci.yml --commit "$full" --json conclusion -q '.[0].conclusion')" \
      || { echo "could not read the CI runs of $REPO for $sha" >&2; exit 1; }
    [ "$ci" = success ] || {
      echo "refusing to load $sha ($full): its CI run concluded '${ci:-none}', not 'success' (none: no CI run for that commit). CI_GATE=off overrides." >&2
      exit 1
    }
  fi
  # No run given: build now. An image is built only to be loaded, so none waits in Actions storage (DECISIONS #11).
  if [ -z "$run" ]; then run="$(build_ref "$full")"; fi
  local artifact
  artifact="$(gh api "repos/$REPO/actions/runs/$run/artifacts" -q '.artifacts[] | select((.name | startswith("image-")) and (.expired | not)) | .id' | head -1)"
  [ -n "$artifact" ] || { echo "run $run has no image artifact (kept one day, deleted once loaded): run ship.sh load without a run id to build again"; exit 1; }
  # GitHub answers with a short-lived signed address for the zip; the box downloads straight from there.
  # The GitHub token reaches curl as a header read from a 0600 file (-H @file): on the command line `ps` would show it.
  local token url
  token="$(gh auth token)"
  HDR_FILE="$(umask 077; mktemp)"
  printf 'Authorization: Bearer %s\n' "$token" >"$HDR_FILE"
  url="$(curl -sI -H "@$HDR_FILE" "https://api.github.com/repos/$REPO/actions/artifacts/$artifact/zip" | awk -F': ' 'tolower($1)=="location"{print $2}' | tr -d '\r')"
  rm -f "$HDR_FILE"; HDR_FILE=""
  [ -n "$url" ] || { echo "could not get the artifact address"; exit 1; }
  "${SSH[@]}" "which unzip >/dev/null || sudo apt-get install -y -qq unzip >/dev/null; cd /tmp && curl -sSL -o images.zip \"$url\" && unzip -o -q images.zip && gunzip -c images.tar.gz | docker load && rm -f images.zip images.tar.gz"
  set_env API_IMAGE "dcm-api:$sha"
  set_env WEB_IMAGE "dcm-web:$sha"
  # The box has the images now (and keeps the previous ones, see up): the artifact would only use Actions storage.
  gh api -X DELETE "repos/$REPO/actions/artifacts/$artifact" >/dev/null || echo "note: could not delete artifact $artifact (it expires in a day)" >&2
  echo "box now has dcm-api:$sha and dcm-web:$sha"
}

up() {
  # Stores first, then the migrations as the schema owner, then everything. A failed migration stops here
  # with the old containers still serving. Older images beyond the previous pair only take disk.
  "${SSH[@]}" "cd /opt/dcm && docker compose up -d --wait postgres redis s3 \
    && docker compose run --rm -T --no-deps api node dist/cli/migrate.js </dev/null \
    && docker compose up -d --remove-orphans && docker image prune -f >/dev/null \
    && for i in dcm-api dcm-web; do docker images \$i --format '{{.Repository}}:{{.Tag}}' | tail -n +3 | xargs -r docker rmi >/dev/null 2>&1 || true; done"
  for _ in $(seq 1 60); do
    if "${SSH[@]}" "curl -fsS -o /dev/null http://127.0.0.1/health/ready" 2>/dev/null; then echo "the app answers on the box: http://$HOST/"; return 0; fi
    sleep 3
  done
  echo "ERROR: the app did not come up"; "${SSH[@]}" "cd /opt/dcm && docker compose ps && docker compose logs --tail 40 api"; return 1
}

admin() {
  local email="${1:?ship.sh admin <email>}"
  [ -s "$S/dcm-platform-admin-password" ] || { echo "missing or empty: $S/dcm-platform-admin-password" >&2; exit 1; }
  # The password crosses on stdin and becomes an argument only inside the container (the CLI takes --password).
  "${SSH[@]}" "read -r pw && cd /opt/dcm && docker compose exec -T api node dist/cli/bootstrap-admin.js --email \"$email\" --password \"\$pw\" </dev/null" <"$S/dcm-platform-admin-password"
}

status() { "${SSH[@]}" "free -m | sed -n '1,3p'; echo; docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'; echo; cd /opt/dcm && docker compose ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}'; df -h / | tail -1"; }

backup() {
  "${SCP[@]}" "$HERE/scripts/backup.sh" "deploy@$HOST:/opt/dcm/backup.sh"
  "${SSH[@]}" "chmod +x /opt/dcm/backup.sh && /opt/dcm/backup.sh && \
    (crontab -l 2>/dev/null | grep -v '/opt/dcm/backup.sh'; echo '0 0 * * * /opt/dcm/backup.sh >> /var/backups/dcm/backup.log 2>&1') | crontab - && crontab -l | grep backup"
}

case "$1" in
  config) config ;;
  load) load "${2:-}" ;;
  up) up ;;
  admin) admin "${2:-}" ;;
  status) status ;;
  backup) backup ;;
esac
