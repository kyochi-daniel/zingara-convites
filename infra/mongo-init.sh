#!/usr/bin/env bash
set -euo pipefail

for attempt in $(seq 1 60); do
  if mongosh --quiet --host mongo --eval '
    const admin = db.getSiblingDB("admin");
    if (!admin.auth(process.env.MONGO_USER, process.env.MONGO_PASSWORD)) quit(1);
    if (admin.runCommand({ ping: 1 }).ok !== 1) quit(1);
  ' >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 60 ]; then echo 'MongoDB indisponível para inicialização' >&2; exit 1; fi
  sleep 2
done

mongosh --quiet --host mongo --eval '
  const admin = db.getSiblingDB("admin");
  if (!admin.auth(process.env.MONGO_USER, process.env.MONGO_PASSWORD)) quit(1);
  try { rs.status(); }
  catch (error) {
    if (error.codeName !== "NotYetInitialized") throw error;
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
  }
' >/dev/null
