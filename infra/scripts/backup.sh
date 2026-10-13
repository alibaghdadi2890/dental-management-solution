#!/usr/bin/env bash
# Nightly on the box (cron 00:00 UTC): a pg_dump and an archive of the object store, kept 14 days
# under /var/backups/dcm. The box's disk is the only copy; the parked snapshot (mhdb-studio
# infra/erp/scripts/park.sh) is the off-box one. Installed by `infra/scripts/ship.sh backup`.
set -euo pipefail
umask 077   # the dump and the archive hold patient data: owner-only from the moment they are created
OUT=/var/backups/dcm
STAMP=$(date -u +%Y%m%d-%H%M%S)
cd /opt/dcm
docker compose exec -T postgres pg_dump -U dcm_owner -d dcm --format=custom --no-owner > "$OUT/dcm-$STAMP.dump" </dev/null
sudo tar -C /var/lib/dcm -czf "$OUT/dcm-$STAMP.s3.tgz" s3
find "$OUT" -name 'dcm-*' -mtime +14 -delete
echo "backup $STAMP written to $OUT"
