# synthetic-monitor

Hourly synthetic monitoring for the live sites. A real headless browser opens each key page
and asserts it actually works — not just that it returns HTTP 200.

**Why:** client-rendered pages return 200 while being completely dead. Proven twice on
StickerHunt: 06.06.2026 a `defer` broke the rating page, and 14.08.2026 Supabase PostgREST
went down and four pages served 200 with no content. An uptime ping saw nothing both times.

## Targets

| Target | Site | What actually proves it is alive |
|---|---|---|
| `ledap` | ledap.win | Countdown renders; `/health` shows a cron event newer than 6h (dead-man on the scheduler) |
| `goat` | goatapp.club | Landing renders; Supabase `gw_config` / `fixtures` / `players` return rows |
| `soker` | soker.win | `#lobby` renders after game.js boots; `/api/health` ok |
| `formalista` | formalista.org | `#quote` and `#attr` are non-empty (they ship empty); `cards.json` has 100+ cards; a real article page from that feed renders |

## Running one locally

```bash
npm ci
npx playwright install chromium
node monitor.mjs ledap
```

Green run is silent. A failure prints the reasons, exits non-zero, and — with
`TELEGRAM_BOT_TOKEN` set — sends one Telegram alert.

## Adding a target

Drop a file in `targets/`, add its name to the matrix in
`.github/workflows/monitor.yml`. A target exports `{ label, baseUrl, checks }`, where
`checks` is an array or an async function returning one (use the function form when a check
must be derived from live content instead of a hardcoded URL that will rot).

### Check types

- `expectNonEmpty: '#sel'` — node exists, is visible, and has text. **Use this for anything
  that proves data arrived.** Every one of these sites ships its empty containers in static
  HTML, so a plain presence check stays green on a dead site.
- `expect: '#sel'` — node merely present. Structural pages only.
- `expectText: 'substring'` — substring must appear in the visible body text.
- `softContent: true` — page just must not be blank (<40 chars). For auth-gated pages.
- `allowAccessDenied: true` — "Access Denied" is legitimate here (admin pages).
- `type: 'json'` with `must(data)` — direct fetch; return a failure string or `null`.

## Logging and reviewing quality

Every run — green ones included — writes a per-check table (result, duration, detail) to the
GitHub run summary, and prints one `MONITOR_RESULT {...}` JSON line into the raw log. A check
that fails and then passes on the retry is recorded as a **flake** (`⚠️ retry`): nobody is
alerted, but it is the early warning that a check is unstable.

To review how well the monitor itself is doing:

```bash
node report.mjs 30      # coverage gaps, failures per target, duration trend. Needs `gh`.
```

Coverage gaps are the point of that report: silence from a monitor that stopped running looks
exactly like silence from a healthy site.

## Notes

- The repo is public so Actions minutes are free and unmetered. Three of the four project
  repos are private, where an hourly monitor would blow the 2000 min/mo allowance and choke
  every other workflow in them.
- 🔴 The catch of being public: GitHub disables scheduled workflows after 60 days with no
  repository activity. Long silent stretches are this repo's normal state, so `keepalive.yml`
  pushes one empty commit a month to reset that clock.
- The hourly run is at :17, not :00 — GitHub delays cron at the top of the hour under load.
- Only `TELEGRAM_BOT_TOKEN` (@ksu_bot) is a secret. GOAT's Supabase publishable key is
  read from the deployed `app.js` — it is public by design, and reading it live means the
  check survives a key rotation and proves `app.js` deployed.
- Not covered here, deliberately: Telegram bots, Workers without a UI, and n8n workflows.
  They have no pages; they need a different kind of check (кошик 2).
