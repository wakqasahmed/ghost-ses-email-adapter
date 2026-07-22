#!/bin/sh

set -eu

adapter_path=/var/lib/ghost/content/adapters/email/ses
mkdir -p "$(dirname "$adapter_path")"
cp -a /opt/ghost-ses-email-adapter "$adapter_path"
chown -R node:node /var/lib/ghost/content/adapters

exec docker-entrypoint.sh "$@"
