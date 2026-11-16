#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_PATH:?Informe BACKUP_PATH criado pelo backup-prod.sh}"
[[ -f "$BACKUP_PATH/mongo.archive.gz" && -f "$BACKUP_PATH/uploads.tar.gz" && -f "$BACKUP_PATH/SHA256SUMS" &&
  -f "$BACKUP_PATH/counts.json" && -f "$BACKUP_PATH/media_count.txt" && -f "$BACKUP_PATH/database.txt" ]] || {
  echo 'Backup incompleto' >&2; exit 1;
}
(cd "$BACKUP_PATH" && sha256sum -c SHA256SUMS >/dev/null)
database="$(cat "$BACKUP_PATH/database.txt")"
[[ "$database" =~ ^[a-zA-Z0-9_-]{1,64}$ ]] || { echo 'Nome do banco inválido' >&2; exit 1; }

container="zingara-restore-$RANDOM-$$"
password="$(openssl rand -hex 24)"
media="$(mktemp -d)"
docker run --rm -d --network none --name "$container" \
  -e MONGO_INITDB_ROOT_USERNAME=restore -e MONGO_INITDB_ROOT_PASSWORD="$password" \
  mongo:8.0.16 >/dev/null
trap 'docker stop "$container" >/dev/null 2>&1 || true; rm -r -- "$media"' EXIT

ready=0
for attempt in $(seq 1 60); do
  if docker exec "$container" mongosh --quiet --host localhost --username restore --password "$password" \
    --authenticationDatabase admin --eval 'db.adminCommand({ ping: 1 }).ok' 2>/dev/null | grep -qx 1; then ready=1; break; fi
  sleep 2
done
[[ "$ready" -eq 1 ]] || { echo 'Mongo isolado indisponível' >&2; exit 1; }

docker exec -i "$container" mongorestore --host localhost --username restore --password "$password" \
  --authenticationDatabase admin --archive --gzip --drop --quiet < "$BACKUP_PATH/mongo.archive.gz"
docker exec -e RESTORE_DATABASE="$database" "$container" mongosh --quiet --host localhost \
  --username restore --password "$password" --authenticationDatabase admin --eval '
    const selected = db.getSiblingDB(process.env.RESTORE_DATABASE);
    const names = selected.getCollectionNames().sort();
    const counts = Object.fromEntries(names.map(name => [name, selected.getCollection(name).countDocuments({})]));
    print(JSON.stringify(counts));
  ' > "$media/restored-counts.json"
cmp -s "$BACKUP_PATH/counts.json" "$media/restored-counts.json" || { echo 'Contagens restauradas divergem do backup' >&2; exit 1; }
tar -tzf "$BACKUP_PATH/uploads.tar.gz" | while IFS= read -r item; do
  case "$item" in /*|../*|*/../*|*/..) echo 'Caminho inseguro no backup de mídia' >&2; exit 1;; esac
done
tar -xzf "$BACKUP_PATH/uploads.tar.gz" -C "$media"
actual_media="$(find "$media" -type f ! -name 'restored-counts.json' | wc -l | tr -d ' ')"
expected_media="$(cat "$BACKUP_PATH/media_count.txt")"
[[ "$actual_media" = "$expected_media" ]] || { echo 'Quantidade de mídia restaurada diverge do backup' >&2; exit 1; }
echo "Arquivos de mídia restaurados: $actual_media"
echo 'Restauração isolada concluída; nenhum serviço da aplicação foi iniciado.'
