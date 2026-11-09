# FamTO fürs iPhone

App (Kalender in der App, Spracheingabe, Fotos) und Widget (Heute, Morgen, Board).
Gebaut wird über GitHub Actions auf einem Mac (`.github/workflows/ios.yml`), ein eigener Mac ist nicht nötig.

## Einmalig einrichten

1. **Apple-Entwicklerkonto** abschließen (99 € im Jahr): https://developer.apple.com/programs/
2. **App in App Store Connect anlegen**: https://appstoreconnect.apple.com → Apps → „+“ → Neue App
   - Plattform iOS, Name „FamTO“, Sprache Deutsch
   - Bundle-ID: `de.famto.app` (falls nicht in der Liste: unter developer.apple.com → Identifiers anlegen,
     dazu `de.famto.app.widget` und die App Group `group.de.famto.app`)
   - SKU: beliebig, z. B. `famto`
3. **API-Schlüssel erzeugen**: App Store Connect → Benutzer und Zugriff → Integrationen → App Store Connect API →
   „+“, Zugriff „App-Manager“. Die `.p8`-Datei herunterladen (geht nur einmal), Key ID und Issuer ID notieren.
4. **Team-ID** steht unter https://developer.apple.com/account → Mitgliedschaft.
5. **Vier Secrets im GitHub-Repository** anlegen (Settings → Secrets and variables → Actions → New repository secret):
   - `APPLE_TEAM_ID`: die Team-ID
   - `ASC_KEY_ID`: die Key ID
   - `ASC_ISSUER_ID`: die Issuer ID
   - `ASC_KEY_P8`: der komplette Inhalt der `.p8`-Datei (mit den Zeilen BEGIN/END)

Danach baut jeder Push in `ios/` (oder „Run workflow“ unter Actions → iPhone-App) die App signiert
und lädt sie zu **TestFlight** hoch.

## Familie einladen

App Store Connect → FamTO → TestFlight → Interne Tester (bis 100 Personen aus dem Team) oder
Externe Tester per E-Mail oder öffentlichem Link. Auf dem iPhone die App **TestFlight** aus dem App Store
installieren, Einladung annehmen, FamTO installieren. Updates kommen dann automatisch über TestFlight.

## Erster Start

FamTO öffnen und wie gewohnt mit Einladungscode beitreten oder „Ich war schon dabei“ wählen.
Danach bekommt das Widget automatisch den persönlichen Code. Widget hinzufügen: Startbildschirm lange
drücken → „+“ oben links → FamTO → Größe wählen.
