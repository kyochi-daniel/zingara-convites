#!/usr/bin/env bash
set -euo pipefail

: "${MONGO_REPLICA_KEY:?MONGO_REPLICA_KEY ausente}"
install -d -m 700 -o mongodb -g mongodb /data/configdb
printf '%s' "$MONGO_REPLICA_KEY" > /data/configdb/keyfile
chown mongodb:mongodb /data/configdb/keyfile
chmod 400 /data/configdb/keyfile
unset MONGO_REPLICA_KEY
exec docker-entrypoint.sh mongod --replSet rs0 --auth --keyFile /data/configdb/keyfile --bind_ip_all
