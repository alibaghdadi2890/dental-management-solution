#!/usr/bin/env bash
# Runs on the box at every boot (systemd unit dcm-boot.service, installed by infra/scripts/ship.sh files),
# after Docker. A Start after a park gives the box a new public IP: read it from the instance metadata
# service and, when it changed, rewrite PUBLIC_IP in .env, and PUBLIC_ORIGIN too when that is the bare-IP
# form http://<ip> (with a domain it stays; the domain's DNS record is repointed instead). Then recreate
# the containers that read them. Nothing to do otherwise.
set -euo pipefail
cd /opt/dcm
token="$(curl -s --max-time 5 -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')"
ip="$(curl -s --max-time 5 -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/public-ipv4)"
[[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "on-boot: no public IP from the metadata service"; exit 0; }
current="$(grep -s '^PUBLIC_IP=' .env | cut -d= -f2-)"
if [ "$ip" = "$current" ]; then echo "on-boot: PUBLIC_IP=$ip unchanged"; exit 0; fi
origin="$(grep -s '^PUBLIC_ORIGIN=' .env | cut -d= -f2-)"
[ "$origin" != "http://$current" ] || origin="http://$ip"
umask 077
{ grep -vE '^(PUBLIC_IP|PUBLIC_ORIGIN)=' .env; echo "PUBLIC_IP=$ip"; [ -z "$origin" ] || echo "PUBLIC_ORIGIN=$origin"; } > .env.next \
  && mv .env.next .env && chmod 600 .env
echo "on-boot: PUBLIC_IP $current → $ip; recreating the containers"
docker compose up -d --remove-orphans
