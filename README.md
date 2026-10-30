# Familienkalender

Gemeinsamer Familienkalender als Web-App (PWA) mit Spracheingabe, Pinnwand und einer Seite für das Flur-Display (WYSCREEN, Bigme, Samsung QM32C).

- **App fürs Handy:** Heute, Kalender (Woche/Monat), Pinnwand, Einstellungen. Über „Zum Home-Bildschirm“ installierbar.
- **Privat oder Familie:** Familientermine sehen alle und das Display. Private Termine sieht nur, wer sie angelegt hat; wahlweise sieht die Familie „belegt“ ohne Details.
- **Spracheingabe:** Das Mikrofon nutzt die Spracherkennung des Browsers. Den Satz versteht Claude (Edge Function `parse-event`); ohne Verbindung greift eine einfache Erkennung auf dem Handy.
- **Rollen:** Admin, Mitglied, Kind (ohne Handy), Gast. Nur der Admin lädt per Einladungscode ein.
- **Display:** `…/#/display/<token>` zeigt nur Familientermine, ohne Anmeldung, über ein geheimes Token pro Display. Variante per `?v=bigme`, `?v=qm`, `?v=color` oder `?v=eink`.

## Ausprobieren ohne Einrichtung

```bash
npm install
npm run dev
```

Ohne Supabase-Zugangsdaten startet die App im **Demo-Modus**: Alles bleibt im Browser, „Beispielfamilie ansehen“ lädt Testdaten, unter Einstellungen lässt sich das Handy einer anderen Person simulieren. Das Display im Demo-Modus: `http://localhost:5173/#/display/demo`.

## Echte Einrichtung

### 1. Supabase-Projekt (kostenlos)

1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen (Region z. B. Frankfurt).
2. **SQL Editor:** den Inhalt von `supabase/migrations/0001_init.sql` einfügen und ausführen.
3. **Authentication → Sign In / Providers:** „Allow anonymous sign-ins“ einschalten. Jedes Handy bekommt so ein eigenes Konto, verbunden über den Einladungscode.
4. **Project Settings → API:** `Project URL` und `anon public` Key notieren.

### 2. KI-Erkennung (optional, empfohlen)

Mit der [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase login
supabase link --project-ref <projekt-ref>
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy parse-event
```

Den API-Key gibt es in der [Claude Console](https://console.anthropic.com). Ohne Function funktioniert die App weiter, nur mit der einfacheren Erkennung.

### 3. App veröffentlichen

**GitHub Pages:** Im Repository unter *Settings → Secrets and variables → Actions* die Secrets `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` anlegen, dann unter *Settings → Pages* als Quelle „GitHub Actions“ wählen. Jeder Push auf `main` veröffentlicht die App.

Lokal mit echter Datenbank: `.env.example` nach `.env` kopieren und ausfüllen.

### 4. Loslegen

1. App öffnen, „Neue Familie anlegen“: Du wirst Admin.
2. Einstellungen → Familie & Mitglieder: Personen anlegen, für jede einen Einladungscode erzeugen. Die Person öffnet die App und gibt den Code ein.
3. Einstellungen → Displays: Adresse kopieren und im WYSCREEN als Webseite eintragen.

## Noch nicht drin

- Push-Nachrichten im Hintergrund (Fahrer-Erinnerung erscheint derzeit, solange die App offen ist)
- Automatische Fahrzeit über einen Routendienst (Fahrzeit wird im Termin eingetragen)
- Anbindung an Google-, Apple- und Outlook-Kalender
- WhatsApp-Weiterleitung an die Pinnwand

## Aufbau

```
src/app/        Handy-App (React)
src/display/    Display-Seite
src/lib/        Datenmodell, Speicher (Supabase oder Demo), Erkennung
supabase/       Datenbank-Schema mit Zugriffsregeln, Edge Function
```
