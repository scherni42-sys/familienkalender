#!/bin/sh
# Wöchentliche Sicherung: Forgejo (Code, Konten, Einstellungen), Supabase-Datenbank und Signierschlüssel
# in die Hetzner Storage Box. Einrichten mit:  crontab -e  →  30 3 * * 0 /srv/famto/server/sicherung.sh
# Benötigt in /srv/famto/server/.env zusätzlich:
#   SUPABASE_DB_URL=postgresql://...   (Supabase → Project Settings → Database → Connection string, Session pooler)
#   STORAGE_BOX=u123456@u123456.your-storagebox.de
set -eu
. /srv/famto/server/.env
DAY=$(date +%F)
OUT=/srv/famto/backup/$DAY
mkdir -p "$OUT"
docker compose -f /srv/famto/server/docker-compose.yml exec -T -u git forgejo forgejo dump --type tar.gz -f - > "$OUT/forgejo.tar.gz"
docker run --rm postgres:17 pg_dump --no-owner --format=custom "$SUPABASE_DB_URL" > "$OUT/supabase.dump"
cp /srv/famto/keystore/widget.keystore "$OUT/" 2>/dev/null || true
rsync -a -e "ssh -p 23" "$OUT" "$STORAGE_BOX:famto/"
# Auf dem Server nur die letzten 4 Sicherungen behalten (in der Storage Box bleiben alle)
ls -1d /srv/famto/backup/* | head -n -4 | xargs -r rm -rf
