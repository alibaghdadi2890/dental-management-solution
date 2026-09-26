#!/bin/sh
# SeaweedFS with its S3 gateway, plus the local bucket (ADR-0006). Creating the bucket here rather
# than in a one-shot service keeps `docker compose up --wait` green.
set -eu

BUCKET="${S3_BUCKET:-dcm-local}"
MASTER=127.0.0.1:9333

weed server -dir=/data -ip=127.0.0.1 -ip.bind=0.0.0.0 -volume.max=16 -master.volumeSizeLimitMB=64 \
  -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json &
server=$!

until echo "s3.bucket.list" | weed shell -master="$MASTER" 2>/dev/null | grep -q "$BUCKET"; do
  echo "s3.bucket.create -name $BUCKET" | weed shell -master="$MASTER" >/dev/null 2>&1 || true
  sleep 1
done
touch /tmp/ready

wait "$server"
