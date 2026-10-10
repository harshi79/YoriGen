# ORIGEN

A developer-only payment test-data and BIN metadata utility. Built with TypeScript, Vite, native DOM components, and local Lucide icons.

Community & updates: [Join Channel on Telegram](https://t.me/+y8EekRvqpnQzNjZl)

## Workspace Tabs

1. **Generator**: 100% local synthetic card fixture generator, built as a five-step flow.
   - **Step 1 · BIN / IIN** — enter an explicit 6–8 digit synthetic test prefix, a masked template such as `5279109907xxxxxx`, or switch on **Auto** to have a network-compatible prefix built locally. A masked template retains every visible digit and fills each `x` position locally with synthetic data. Network is detected from the visible prefix with existing local rules (Auto / Random, or a pinned network).
     Nine networks are supported, each with its own prefix ranges, accepted number lengths and CVV width:

     | Network | Prefixes | Number length | CVV |
     | --- | --- | --- | --- |
     | Visa | `4` | 16 | 3 |
     | Mastercard | `51`–`55`, `2221`–`2720` | 16 | 3 |
     | Amex | `34`, `37` | 15 | 4 |
     | Discover | `6011`, `644`–`649`, `65`, `622126`–`622925` | 16 | 3 |
     | JCB | `3528`–`3589` | 16–19 | 3 |
     | Diners | `300`–`305`, `3095`, `36`, `38`–`39` | 14–19 | 3 |
     | UnionPay | `62`, `81` | 16–19 | 3 |
     | Maestro | `5018`, `5020`, `5038`, `56`–`69`, `6759`, `6761`–`6763` | 16–19 | 3 |
     | RuPay | `60`, `65`, `81`, `8214`–`8220` | 16 | 3 |

     Some ranges are shared between schemes (`51`–`55`, `62`, `65`, `81`), exactly as they are in the real world. Auto/Random picks uniformly among the compatible networks, and the Card Sorter keeps the narrower original scheme first when a prefix matches more than one. Input is validated before anything is generated; complete unmasked card-like numbers are rejected and never truncated into a prefix.
   - **Step 2 · Expiry** — **Auto** creates a synthetic future month/year locally, or choose **Custom** month + year from the dropdowns. Past and current-month values are refused with an inline message.
   - **Step 3 · CVV** — **Auto** uses the network-appropriate synthetic length (4 digits for Amex, 3 for the rest), or enter a **Custom** value of the correct length. Custom CVVs stay in the page and are never sent anywhere.
   - **Step 4 · Quantity** — 1–100, with quick presets 1 / 5 / 10 / 25 / 50 / 100.
   - **Step 5 · Generate** — a live summary line (e.g. `Visa · 16 digits · Auto expiry · Auto CVV · 10 fixtures`) previews the run above the large `Generate Test Data` button.
   - Friendly inline, field-scoped errors for an invalid BIN, an unsupported prefix/network combination, an invalid expiry, a CVV length that does not fit the network, and an invalid quantity — nothing is generated while a field is invalid.
   - Local Luhn checksum generation; Auto modes never leave the browser.
   - Clear banner: `TEST DATA ONLY — NOT REAL PAYMENT CARDS`, plus a `SYNTHETIC TEST FIXTURE` label on the results banner, every table row, and in the code view.
   - Results table with individual record copy, Copy All, and TXT / CSV / JSON export downloads.
   - Code and table views, clear function, and performance timing.

2. **BIN Lookup**: Dedicated prefix metadata lookup tab using `https://guison-api.onrender.com`.
   - Strictly accepts **6–8 digit BIN/IIN prefixes only**. Full card numbers, CVVs, and expiry dates are rejected locally and never sent.
   - Displays all available issuing metadata: BIN, Scheme/Network, Brand, Card Type, Product/Level, Issuer, Country + Flag, Currency, Number Length, Luhn compatibility, Prepaid status, and formatted raw JSON.
   - Actions: Lookup, Clear, Copy Metadata, Copy JSON.
   - Session-only recent lookups (capped at 10, stored in page memory, offline reviewable, cleared on reload).
   - Resilient design: if Guison is down or unreachable, the local generator continues to function completely independently.

3. **Card Sorter**: a local organizer for test data you already have.
   - Large paste area (`Paste one card record per line`) plus drag & drop or file-picker loading of plain-text files (read locally with the File API, never uploaded).
   - Accepts common developer/test shapes: `number|MM|YYYY|CVV`, `number|MM/YY|CVV`, `number,MM,YYYY,CVV`, `number:MM:YYYY:CVV`, tab/semicolon or double-space variants, and a bare number per line.
   - Unrecognized lines are **preserved**, never silently deleted. Only the explicit `Remove invalid/empty lines` action drops them, and it reports how many went.
   - One-click cleaning actions: Remove duplicates, Remove empty lines, Trim whitespace, Normalize separators, Remove exact duplicate records, Remove invalid/empty lines, Reverse order, and Keep original order.
   - Sorting by full line, first field / number prefix, network detected locally from the supplied prefix (all nine networks above), and parsed expiry — always local, never a lookup.
   - Live statistics: input lines, unique lines, duplicates removed, empty lines removed, remaining lines, plus a Before / After counter.
   - Output area with one record per line: Copy All, Download TXT, Select All and Clear, with toasts, empty/loading/error states and keyboard shortcuts.
   - Visible note: `Local text processing — data is not uploaded.`

4. **Settings**:
   - Dark/light theme switcher (the only setting persisted to `localStorage`).
   - Manual Guison API readiness check (`/readyz`).
   - Clear session lookup history button.
   - Clear safety guidelines and development boundaries.

## Interface

- Renamed end to end to **ORIGEN** (page title, wordmark, navigation, Open Graph metadata, README).
- The header carries a **Join Channel** button that opens the ORIGEN Telegram channel in a new tab. It is keyboard reachable, has an explicit accessible label, and collapses to a compact icon button on very narrow screens.

## Strict Boundaries & Safety

- **Synthetic test data only**: This tool is designed strictly for frontend form validation, mock API services, UI testing, and QA fixture creation. Generated rows are labeled `SYNTHETIC TEST FIXTURE` and are never claimed to belong to real accounts.
- **Never implemented**: Payment processing, transactions, authorizations, balance checking, live card checking, merchant testing, or card scraping.
- **Card Sorter is text handling only**: it cleans, deduplicates and sorts text already in the page. It does not verify a card, check whether a card is active, run transactions, contact payment processors, query banks, scrape card databases, or send pasted data to any API. All processing happens in the browser and no request is made while sorting.
- **Generator is offline by design**: BIN detection, expiry and CVV Auto modes, Luhn checksums and validation all run in the browser. There is no external card-validation service, no authorization, and no live-card checking.
- Generated cards are not issued test accounts and are never verified against banks or card networks.

## Running Locally

```bash
npm install
npm run dev         # Starts Vite dev server on 0.0.0.0:5173
npm run build       # Strict TypeScript check and production build (outputs dist/)
npm start           # Serves the built dist/ on 0.0.0.0:$PORT (default 8080)
npm test            # 387 Vitest unit tests + static-server integration tests
npm run test:coverage  # Same suite with a V8 report in coverage/, enforcing thresholds
npm run test:e2e    # Playwright browser tests across viewports (generator, BIN lookup, Card Sorter)
npm run lint        # ESLint check
```

## Continuous Integration

`.github/workflows/ci.yml` runs on every push to `main`, every pull request, and
on demand:

| Job | Node | Runs |
| --- | --- | --- |
| `quality` | 20 and 22 | `npm run lint`, `tsc --noEmit`, `npm run test:coverage` (uploads the coverage report) |
| `build` | 22 | `npm run build`, `npm run test:server`, uploads `dist/` |
| `docker` | 22 | `docker build`, then boots the container and hits `/healthz` |
| `e2e` | 22 | `playwright test` on the `desktop` and `mobile` projects |

`build` and `e2e` wait for `quality`, so a lint or type failure short-circuits the
expensive jobs. Superseded runs on the same branch are cancelled automatically.

## Deployment

ORIGEN is a static, client-side app, so it can be hosted either as static files
or as a long-running web service. This repository supports both.

**Static hosting** (Netlify, Vercel, GitHub Pages, Cloudflare Pages, S3, ...):
build with `npm run build` and publish the `dist/` directory.

**Web service / container hosts** (Railway, Render, Fly, Heroku, ...):
the platform starts the app with the standard npm start command.

**Docker**: a multi-stage `Dockerfile` builds the app and runs `server.js` as a
non-root user, with a `/healthz` `HEALTHCHECK` baked in.

```bash
docker build -t origen .
docker run --rm -p 8080:8080 origen
```

```bash
npm install
npm run build       # produces dist/
npm start           # node server.js — serves dist/
```

`server.js` is a dependency-free Node static server that:

- binds `0.0.0.0` and honours the platform-provided `PORT` variable (default `8080`),
- serves `dist/` with correct MIME types, plus client-side routing fallback to `index.html`,
- sends long-lived immutable cache headers for hashed assets and `no-cache` for the app shell,
- exposes `GET /healthz` (returns `200 {"status":"ok"}` when the build is present) for health checks.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on (set automatically by most hosts) |
| `HOST` | `0.0.0.0` | Interface to bind |
| `ORIGEN_STATIC_DIR` | `./dist` | Directory of built files to serve |

Host configuration is committed for the common platforms:

- `railway.json` — build `npm install && npm run build`, start `node server.js`, health check `/healthz`.
- `render.yaml` — Render blueprint with the same build/start commands.

No start command needs to be set manually in the dashboard.
