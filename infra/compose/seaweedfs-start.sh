#!/bin/sh
# SeaweedFS with its S3 gateway and the one bucket, on the box (docker-compose.yml). The same shape
# as docker/seaweedfs/start.sh for local dev, sized for real files: 256 MB volumes, as many as the
# disk allows (-volume.max=0), instead of 16 × 64 MB.
set -eu

BUCKET="${S3_BUCKET:-dcm}"
MASTER=127.0.0.1:9333

weed server -dir=/data -ip=127.0.0.1 -ip.bind=0.0.0.0 -volume.max=0 -master.volumeSizeLimitMB=256 \
  -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json &
server=$!

until echo "s3.bucket.list" | weed shell -master="$MASTER" 2>/dev/null | grep -q "$BUCKET"; do
  echo "s3.bucket.create -name $BUCKET" | weed shell -master="$MASTER" >/dev/null 2>&1 || true
  sleep 1
done
touch /tmp/ready

wait "$server"
