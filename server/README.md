# FamTO-Server einrichten (Hetzner, Forgejo)

Diese Anleitung setzt voraus: ein Hetzner-Cloud-Server mit Ubuntu 24.04, Backups und Firewall (Ports 22, 80, 443, 2222 offen) und eine Domain, bei der `git.` und `app.` auf die IP des Servers zeigen.

Im Folgenden steht `famto.example` für deine Domain.

## 1. Domain im Code eintragen

Im Projekt ist die neue Adresse als Platzhalter `app.famto.example` eingetragen. Einmal ersetzen (auf deinem Rechner im Projektordner):

```sh
grep -rl "famto.example" --exclude-dir=node_modules . | xargs sed -i "s/famto\.example/DEINE-DOMAIN.de/g"
```

## 2. Server vorbereiten

```sh
ssh root@SERVER-IP
apt update && apt -y upgrade && apt -y install unattended-upgrades rsync
curl -fsSL https://get.docker.com | sh
mkdir -p /srv/famto/{server,forgejo,postgres,runner,caddy,app,keystore,backup}
chown 1000:1000 /srv/famto/forgejo
```

Den Ordner `server/` aus dem Projekt nach `/srv/famto/server/` kopieren (z. B. mit `scp -r server root@SERVER-IP:/srv/famto/`), dann:

```sh
cd /srv/famto/server
cp .env.example .env && nano .env      # DOMAIN und ein langes DB_PASSWORD eintragen
docker compose up -d forgejo db caddy
```

## 3. Forgejo einrichten

1. `https://git.DEINE-DOMAIN.de` öffnen. Die Datenbankwerte sind schon vorausgefüllt, nur ein Administrator-Konto anlegen.
2. Im Profil unter Einstellungen → Sicherheit die Zwei-Faktor-Anmeldung einschalten.
3. Neue Organisation `famto` anlegen, darin ein leeres, privates Repository `familienkalender`.
4. In der Organisation unter Einstellungen → Actions → Runner einen Registrierungs-Token erzeugen.

## 4. Bau-Runner verbinden

```sh
cd /srv/famto/server
docker compose run --rm runner forgejo-runner register --no-interactive \
  --instance https://git.DEINE-DOMAIN.de --token TOKEN --name hetzner \
  --labels docker:docker://node:22-bookworm
cp runner-config.yml /srv/famto/runner/config.yml
docker compose up -d runner
```

## 5. Code hochladen

Auf deinem Rechner, im Ordner mit der Datei `familienkalender-umzug.bundle`:

```sh
git clone -b main-neu familienkalender-umzug.bundle familienkalender
cd familienkalender
git remote set-url origin https://git.DEINE-DOMAIN.de/famto/familienkalender.git
git push -u origin main-neu:main
```

Diese Sicherung ist vollständig und enthält den aktuellen Stand als einen einzigen Schritt. Die ältere Versionsgeschichte kann später aus dem GitHub-Export ergänzt werden.

## 6. Geheimwerte hinterlegen

In Forgejo: Organisation `famto` → Einstellungen → Actions → Secrets.

| Name | Woher |
| --- | --- |
| VITE_SUPABASE_URL | Supabase → Project Settings → API → Project URL |
| VITE_SUPABASE_ANON_KEY | Supabase → Project Settings → API → anon/public key |
| WIDGET_KEY_PASS | ein neues, langes Passwort (im Passwort-Manager notieren) |
| WIDGET_KEYSTORE | nur falls du den alten Signierschlüssel als Datei hast: `base64 -w0 widget.keystore` |

Ohne `WIDGET_KEYSTORE` erzeugt der erste Bau einen neuen Schlüssel und legt ihn in `/srv/famto/keystore/` ab. Diese Datei sofort zusätzlich sichern (Passwort-Manager, USB-Stick). Ohne sie sind später keine Updates mehr möglich.

## 7. Erster Bau und Umstellung

1. In Forgejo unter Actions die Abläufe „Web-App“ und „Widget-App“ von Hand starten.
2. `https://app.DEINE-DOMAIN.de` muss die App zeigen, `https://app.DEINE-DOMAIN.de/download/familien-widget.apk` die APK liefern.
3. In Supabase unter Authentication → URL Configuration die neue Adresse als Site URL und als Redirect URL eintragen.
4. Auf jedem Familienhandy: alte App deinstallieren, neue APK installieren, in der Web-App unter Einstellungen den Einrichtungscode neu erzeugen und in der App einlesen.
5. Die Kalender-Daten bleiben dabei erhalten, sie liegen in Supabase.

## 8. Wöchentliche Sicherung

Eine Hetzner Storage Box buchen, den SSH-Schlüssel des Servers dort hinterlegen, in `.env` `SUPABASE_DB_URL` und `STORAGE_BOX` ergänzen und dann:

```sh
crontab -e
# Zeile einfügen:
30 3 * * 0 /srv/famto/server/sicherung.sh
```

## Was sich im Code geändert hat

- Neue Adresse statt `scherni42-sys.github.io` in Android-App, iPhone-App und Fahrzeit-Funktion.
- Die Android-App holt Updates von `app.<domain>/download/` statt von GitHub Releases.
- Versionsnummern der APK beginnen bei 10001, damit sie über den GitHub-Nummern liegen.
- Schriften liegen in der App selbst, nichts wird mehr von Google geladen.
- Neue Bauabläufe in `.forgejo/workflows/` (Web-App und Android). Die alten in `.github/workflows/` bleiben für den Fall, dass GitHub zurückkommt. Der iPhone-Bau braucht weiterhin einen Mac.
