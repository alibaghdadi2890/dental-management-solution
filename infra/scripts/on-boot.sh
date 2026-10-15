#!/usr/bin/env bash
# Runs on the box at every boot (systemd unit dcm-boot.service, installed by infra/scripts/ship.sh config),
# after Docker. A Start after a park gives the box a new public IP, and the app's .env carries that IP
# (AUTH_BASE_URL and the presigned URLs' host): read the address from the instance metadata service and,
# when it changed, rewrite PUBLIC_IP and recreate the containers that read it. Nothing to do otherwise.
set -euo pipefail
cd /opt/dcm
token="$(curl -s --max-time 5 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')"
ip="$(curl -s --max-time 5 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/public-ipv4)"
[[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "on-boot: no public IP from the metadata service"; exit 0; }
current="$(grep -s '^PUBLIC_IP=' .env | cut -d= -f2-)"
if [ "$ip" = "$current" ]; then echo "on-boot: PUBLIC_IP=$ip unchanged"; exit 0; fi
umask 077
{ grep -v '^PUBLIC_IP=' .env; echo "PUBLIC_IP=$ip"; } > .env.next && mv .env.next .env && chmod 600 .env
echo "on-boot: PUBLIC_IP $current → $ip; recreating the containers"
docker compose up -d --remove-orphans
