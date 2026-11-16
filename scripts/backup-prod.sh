#!/usr/bin/env bash
set -euo pipefail

: "${PROD_ENV_FILE:?Informe PROD_ENV_FILE com o ambiente de produção}"
: "${BACKUP_DIR:?Informe BACKUP_DIR em armazenamento externo}"
[[ "$BACKUP_DIR" = /* ]] || { echo 'BACKUP_DIR deve ser absoluto' >&2; exit 1; }
[[ -f "$PROD_ENV_FILE" ]] || { echo 'PROD_ENV_FILE não encontrado' >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
umask 077

root="$(cd "$(dirname "$0")/.." && pwd)"
compose=(docker compose --env-file "$PROD_ENV_FILE" -f "$root/infra/compose.prod.yml")
temporary="$(mktemp -d "$BACKUP_DIR/.incomplete.XXXXXXXX")"
stopped=0
cleanup() {
  if [[ "$stopped" -eq 1 ]]; then "${compose[@]}" start api worker >/dev/null || true; fi
  [[ ! -d "$temporary" ]] || rm -r -- "$temporary"
}
trap cleanup EXIT

# Pausa escrita no banco e nos uploads para obter um par consistente.
stopped=1
"${compose[@]}" stop worker api >/dev/null

"${compose[@]}" exec -T mongo bash -c '
  mongodump --host localhost --username "$MONGO_INITDB_ROOT_USERNAME" \
    --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin \
    --db "$MONGO_DATABASE" --archive --gzip --quiet
' > "$temporary/mongo.archive.gz"
"${compose[@]}" run --rm --no-deps -T api tar -C /app/uploads -czf - . > "$temporary/uploads.tar.gz"
[[ -s "$temporary/mongo.archive.gz" && -s "$temporary/uploads.tar.gz" ]] || { echo 'Backup incompleto' >&2; exit 1; }
"${compose[@]}" exec -T mongo printenv MONGO_DATABASE > "$temporary/database.txt"
"${compose[@]}" exec -T mongo bash -c 'mongosh --quiet --host localhost \
  --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin --eval '\''
    const selected = db.getSiblingDB(process.env.MONGO_DATABASE);
    const names = selected.getCollectionNames().sort();
    print(JSON.stringify(Object.fromEntries(names.map(name => [name, selected.getCollection(name).countDocuments({})]))));
  '\''' > "$temporary/counts.json"
tar -tzf "$temporary/uploads.tar.gz" | awk '$0 != "." && $0 !~ /\/$/ { count++ } END { print count + 0 }' > "$temporary/media_count.txt"
[[ -s "$temporary/counts.json" ]] || { echo 'Manifesto de backup incompleto' >&2; exit 1; }
(cd "$temporary" && sha256sum mongo.archive.gz uploads.tar.gz database.txt counts.json media_count.txt > SHA256SUMS)

destination="$BACKUP_DIR/zingara-$(date -u +%Y%m%dT%H%M%SZ)"
mv "$temporary" "$destination"
"${compose[@]}" start api worker >/dev/null
stopped=0
echo "Backup criado em $destination"
