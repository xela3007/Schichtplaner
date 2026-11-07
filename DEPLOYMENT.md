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

- Ein Railway-Projekt `schichtplaner`, Environments **staging** und **production**
- Service **web**: `Dockerfile.web`, Konfiguration `railway.web.json`, einzige
  öffentliche Adresse. nginx liefert die App aus und reicht genau die
  API-Endpunkte an `api` weiter → Frontend und API haben dieselbe Origin
- Service **api**: `Dockerfile.api`, Konfiguration `railway.api.json`, ohne
  öffentliche Domain. Vor jedem Deploy läuft `node dist/api/scripts/migrate.js`
  (Pre-Deploy). Schlägt das fehl, bleibt die alte Version online
- Watch-Paths in den beiden `railway.*.json` sorgen dafür, dass ein reiner
  Frontend-Commit nur `web` deployt und umgekehrt; `src/shared/**` deployt beide

## Umgebungsvariablen

### api

| Variable                | staging                                  | production                                | Hinweis                                             |
| ----------------------- | ---------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| `NODE_ENV`              | `production`                             | `production`                              |                                                     |
| `DATABASE_URL`          | Neon `staging`, pooled                   | Neon `production`, pooled                 | Secret                                              |
| `DATABASE_URL_UNPOOLED` | Neon `staging`, direkt                   | Neon `production`, direkt                 | Secret, für Migrationen                             |
| `JWT_SECRET`            | zufällig, 48 Byte                        | zufällig, 48 Byte, **anders als staging** | Secret                                              |
| `WEB_APP_URL`           | `https://${{web.RAILWAY_PUBLIC_DOMAIN}}` | dito                                      | Ziel des Bestätigungslinks                          |
| `TRUST_PROXY`           | `true`                                   | `true`                                    | Client-IP aus `X-Forwarded-For` (von nginx gesetzt) |
| `COOKIE_SAMESITE`       | `lax`                                    | `lax`                                     | gleiche Origin (ADR-014)                            |
| `CORS_ORIGINS`          | leer                                     | leer                                      | keine fremden Origins                               |
| `LOG_LEVEL`             | `info`                                   | `info`                                    |                                                     |

`PORT` und `RAILWAY_GIT_COMMIT_SHA` setzt Railway selbst. `HOST` ist im Code
auf `::` vorbelegt (privates Netz ist IPv6).

### web

| Variable           | Wert                                                   | Hinweis                                      |
| ------------------ | ------------------------------------------------------ | -------------------------------------------- |
| `API_INTERNAL_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` | Ziel der Weiterleitung                       |
| `API_BASE_URL`     | leer                                                   | landet in `config.js`; leer = gleiche Origin |
| `PORT`             | `8080`                                                 |                                              |

Secrets stehen **nur** in Railway — nie im Repo, nie in der CI-Konfiguration.

## Einmalige Einstellungen in der Railway-Oberfläche

Die CLI kann diese Punkte nicht setzen. Je Service (`api`, `web`) und je
Environment:

1. **Settings → Source → Connect Repo:** `xela3007/Schichtplaner`
2. **Settings → Source → Branch:** staging → `main`, production → `production`
3. **Settings → Source → Wait for CI:** einschalten (deployt erst nach grünem
   Check `CI`)
4. **Settings → Config-as-code → Railway Config File:** `railway.api.json` bzw.
   `railway.web.json`
5. Nur `web`: **Settings → Networking → Generate Domain** (Port 8080). `api`
   bekommt **keine** öffentliche Domain

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
