# Deployment (Railway)

Gilt zusammen mit ADR-009 (Verfahren) und ADR-014 (Railway-Umsetzung) im
Umbrella-Repo.

## Aufbau

```
Browser ──HTTPS──▶ Railway Edge (TLS) ──▶ web  (nginx, öffentlich)
                                            │  /health /me /reference /auth/*
                                            ▼  (privates Netz, IPv6)
                                           api  (Node, nicht öffentlich)
                                            │
                                            ▼
                                     Neon Postgres (Branch je Umgebung)
```

- Ein Railway-Projekt `schichtplaner`, Environments **staging** und **production**,
  Region EU West (Amsterdam)
- Service **web**: `Dockerfile.web`, einzige öffentliche Adresse. nginx liefert
  die App aus und reicht genau die API-Endpunkte an `api` weiter → Frontend und
  API haben dieselbe Origin
- Service **api**: `Dockerfile.api`, ohne öffentliche Domain. Vor jedem Deploy
  läuft `node dist/api/scripts/migrate.js` (Pre-Deploy). Schlägt das fehl,
  bleibt die alte Version online
- Builder, Dockerfile, Watch-Paths, Pre-Deploy, Health-Checks, Restart-Policy,
  Branch und Region stehen in **`.railway/railway.ts`** (Railway
  Infrastructure as Code). Watch-Paths sorgen dafür, dass ein reiner
  Frontend-Commit nur `web` deployt und umgekehrt; `src/shared/**` deployt beide

| Umgebung   | Adresse                                      | Branch       |
| ---------- | -------------------------------------------- | ------------ |
| staging    | https://web-staging-dfb8.up.railway.app      | `main`       |
| production | https://web-production-fc782d.up.railway.app | `production` |

## Infrastruktur ändern

Änderungen an Services gehören in `.railway/railway.ts`, nicht in die
Oberfläche. Pro Umgebung erst ansehen, dann übernehmen:

```bash
railway config plan --environment staging
```

```bash
railway config apply --environment staging
```

Danach dasselbe mit `--environment production`. `plan` ändert nichts.
Variablen verwaltet die Datei bewusst **nicht** (`variables: { managed: false }`)
— Secrets bleiben ausschließlich in Railway.

Die früheren Dateien `railway.api.json` / `railway.web.json` („Config as Code“)
nutzt Railway für neue Services nicht mehr; sie sind entfernt.

## Umgebungsvariablen

### api

| Variable                  | staging                                  | production                                | Hinweis                                                                         |
| ------------------------- | ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                | `production`                             | `production`                              |                                                                                 |
| `DATABASE_URL`            | Neon `staging`, pooled                   | Neon `production`, pooled                 | Secret                                                                          |
| `DATABASE_URL_UNPOOLED`   | Neon `staging`, direkt                   | Neon `production`, direkt                 | Secret, für Migrationen                                                         |
| `JWT_SECRET`              | zufällig, 48 Byte                        | zufällig, 48 Byte, **anders als staging** | Secret                                                                          |
| `WEB_APP_URL`             | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` | dito                                      | Ziel des Bestätigungslinks                                                      |
| `TRUST_PROXY`             | `true`                                   | `true`                                    | Client-IP aus `X-Forwarded-For` (von nginx gesetzt)                             |
| `COOKIE_SAMESITE`         | `lax`                                    | `lax`                                     | gleiche Origin (ADR-014)                                                        |
| `CORS_ORIGINS`            | leer                                     | leer                                      | keine fremden Origins                                                           |
| `LOG_LEVEL`               | `info`                                   | `info`                                    |                                                                                 |
| `PLANNER_EMAILS`          | E-Mail(s) der Planerin                   | E-Mail(s) der Planerin                    | Rolle „Planerin“ (Recht `locations.manage`), wird bei Login/Refresh abgeglichen |
| `PORT`                    | `3000`                                   | `3000`                                    | fest, damit `web` die API adressieren kann                                      |
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.api`                         | `Dockerfile.api`                          | Rückfallebene, doppelt zu `.railway/railway.ts`                                 |

`RAILWAY_GIT_COMMIT_SHA` setzt Railway selbst. `HOST` ist im Code auf `::`
vorbelegt (privates Netz ist IPv6). `PORT` muss explizit gesetzt sein: Railways
eigenes, zur Laufzeit vergebenes `PORT` lässt sich aus einem anderen Service
nicht referenzieren — `${{api.PORT}}` wäre sonst leer.

### web

| Variable                  | Wert                                                   | Hinweis                                         |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| `API_INTERNAL_URL`        | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` | Ziel der Weiterleitung                          |
| `API_BASE_URL`            | leer                                                   | landet in `config.js`; leer = gleiche Origin    |
| `PORT`                    | `8080`                                                 |                                                 |
| `RAILWAY_DOCKERFILE_PATH` | `Dockerfile.web`                                       | Rückfallebene, doppelt zu `.railway/railway.ts` |

Secrets stehen **nur** in Railway — nie im Repo, nie in der CI-Konfiguration.

## Einmalige Einstellungen in der Railway-Oberfläche

Nur beim ersten Aufsetzen nötig, heute erledigt:

1. Railway-Konto mit GitHub verbinden (Account Settings → Connected Accounts)
2. Railway-GitHub-App auf `xela3007` installieren, Zugriff nur auf
   `Schichtplaner` (`https://github.com/apps/railway-app/installations/new`)
3. Je Service und Environment einmal **Settings → Source → Connect Repo**:
   `xela3007/Schichtplaner`, **Wait for CI** an. Branch und alles Weitere setzt
   danach `.railway/railway.ts`
4. Öffentliche Domain nur für `web` (`railway domain --service web --port 8080`).
   `api` bekommt **keine** öffentliche Domain

Hinweis: Eine automatische Browser-Übersetzung verfälscht die Railway-Oberfläche
(Projektname, „production“ → „Produktion“). Für railway.com abschalten.

## Release auf Production

Staging deployt automatisch jeden grünen Commit auf `main`. Production nur auf
ausdrückliche Freigabe:

```bash
git fetch origin
git push origin origin/main:production   # nur Fast-Forward, kein --force
```

Vorher prüfen, dass der Commit auf Staging läuft. Migrationen müssen mit der
vorherigen App-Version kompatibel sein (ADR-009), weil ein Rollback das Schema
nicht zurücknimmt.

## Rollback

In Railway beim Service → **Deployments** → älteres Deployment → **Redeploy**.
Kein Hotfix direkt im Container, kein Deploy vom Laptop.

## Logs

Railway → Service → **Logs**. Die API schreibt JSON-Zeilen (ADR-013). Ohne
Mail-Anbieter stehen Bestätigungslinks dort (`mail (console mailer — not
sent)`). In production meldet die API das beim Start als Warnung — echte
Nutzer können sich erst mit einem Mail-Anbieter bestätigen.
