# Project: make.fun Competition #3 Token Launch Radar (token-radar-01)

## Architecture
The system consists of a deterministic offline data pipeline and an interactive high-density DeFi web dashboard designed according to Emil Kowalski design engineering principles and anti-AI-slop aesthetics:

1. **Data Pipeline & Valuation Engine (`main.ts`, `lib/model.ts`)**:
   - Executes under Node.js 22 with native TypeScript type stripping (`node /bot/main.ts`).
   - Ingests `input/snapshot.json` (758 protocols, $50M floor, 40 watchlist pre-token protocols).
   - Generates `board.json` containing 200 pre-token protocols (40 watchlist items + 160 early rankable protocols) strictly sorted descending by implied valuation.
   - Computes valuations using the "radar-2" comps-calibrated multi-factor model (sector Mcap/TVL multiples, sublinear TVL scale elasticity $TVL^{0.97}$, clamped growth velocity $[-60\%, +120\%]$, non-linear peaked maturity curve 90-540d, omnichain breadth factor).
   - Generates concrete, actionable 6-step farm plans (20-600 characters per step, 3-12 steps per protocol, detailing exact actions, capital tiers $50-$250, gas estimates, holding windows, opsec, and revoke protocols).
   - Exports `/output/data.js` assigning `window.RADAR = { ... }` outside `/output/dashboard/` to bypass the 65,536-byte dossier source cap.
   - Invokes `vendor/makefun-board.ts:buildDossier` to generate canonical `/output/dossier.json`.

2. **Token Launch Radar Web Dashboard (`dashboard/`)**:
   - Handcrafted vanilla stack (`index.html`, `app.css`, `app.js`) totaling < 45 KB (well below 65,536-byte dossier text cap).
   - Strictly offline with zero runtime network requests (no `http://` or `https://` in attributes, styles, or imports).
   - High-contrast Dark Financial Terminal / Swiss Precision aesthetic: matte charcoal canvas (`#090d10`), deep slate surface (`#11161b`), hairline borders (`#1c252c`), crisp typography (`Geist Mono`, `JetBrains Mono`, `Inter`), tabular numbers.
   - Zero emojis anywhere in the UI.
   - Micro-interactions: active press state `transform: scale(0.97)` on `:active`, custom `cubic-bezier(0.16, 1, 0.3, 1)` transitions in 150-220ms.
   - 4 integrated views:
     * Main Board: dense financial table with KPI bar, sortable columns, and rank badges.
     * Protocol Detail View: sliding `<dialog>` modal drawer with formula breakdown and 6-step farm plan.
     * Multi-Facet Filtering: text search, category, chain, valuation tier, risk level, readiness tier.
     * Live Token Comps: separate tab showing market cap, TVL, and Mcap/TVL ratios of 144 live token protocols.

3. **Deliverables & Packaging**:
   - `screenshots/`: 3 images (`1-board.png`, `2-detail.png`, `3-filtered.png`) captured via headless Chrome at 1440x900 resolution (each <= 512 KiB).
   - `LICENSE`: OSI-approved MIT license with SPDX identifier.
   - `vendor/makefun-board.ts`: authoritative competition board contract.
   - `dossier.json`: canonical submission artifact matching `makefun/dossier/v1`.
   - Agent execution transcripts.

---

## Feature Inventory
Every survey feature is assigned to a milestone:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Container Sandbox & Determinism | Headless Docker execution, deterministic byte-for-byte outputs across runs | M1 | `RULES.txt` l.104 |
| 2 | Watchlist & Pre-Token Filtering | 100% coverage of 40 watchlist items + 160 early pre-token protocols | M1 | `RULES.txt` l.16 |
| 3 | "radar-2" Valuation Engine | Comps-calibrated multi-factor model (sector multiples, TVL elasticity, growth, maturity, breadth) | M1 | `competition.yaml` Rubric 2 |
| 4 | Actionable Farm Plan Generator | 6-step structured playbook per protocol with capital, gas, time, opsec, unwind | M1 | `competition.yaml` Rubric 3 |
| 5 | `board.json` Generator | 200 rows, strictly decreasing implied values, 1..N ranks, <= 8 MiB | M1 | `RULES.txt` l.24-25 |
| 6 | Out-of-Dashboard Data Decoupling | `data.js` written to `/output/data.js` to preserve 64 KB source dossier cap | M1 | `vendor/makefun-board.ts` l.268 |
| 7 | Offline Dashboard Shell | `dashboard/index.html` with zero external URLs and < 3 KB size | M2 | `ORIGINAL_REQUEST.md` R1 |
| 8 | Anti-AI-Slop Styling & Typography | Dark Swiss terminal theme, zero emojis, custom curves, sub-300ms transitions, scale(0.97) | M2 | `ORIGINAL_REQUEST.md` R1 |
| 9 | Main Board View & KPI Strip | Dense financial table, 4 KPI cards, tabular numbers, sorting headers | M2 | `competition.yaml` Rubric 4 |
| 10 | Protocol Detail Drawer | Sliding dialog, transparent valuation formula breakdown, 6-step farm plan | M2 | `competition.yaml` Rubric 4 |
| 11 | Multi-Facet Filter Controls | Instant text search, category, chain, valuation tier, risk level, readiness | M2 | `ORIGINAL_REQUEST.md` R1 |
| 12 | Live Token Comps Tab | Secondary view showing 144 live token comps justifying valuation multiples | M2 | `competition.yaml` Rubric 2 |
| 13 | Headless Screenshot Pipeline | Python Selenium / headless Chrome capture at 1440x900 resolution (<= 512 KiB each) | M3 | `RULES.txt` l.34 |
| 14 | Canonical Dossier Generation | `vendor/makefun-board.ts:buildDossier` generating valid `dossier.json` <= 1.5 MiB | M3 | `vendor/makefun-board.ts` l.218 |
| 15 | OSI License & Packaging | Valid `LICENSE` file with `SPDX-License-Identifier: MIT` and clean package root | M3 | `RULES.txt` l.108 |
| 16 | 7-Row Pass/Fail Gate Verification | Local automated verification of all 7 competition gate rules | Final M4 / E2E Track | `RULES.txt` l.28-36 |
| 17 | Adversarial Hardening | Edge cases, boundary tests, corrupt data handling, determinism checks | Final M4 / E2E Track | Project Pattern Tier 5 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Watchlist Analysis & Data Pipeline | `package.json`, `vendor/makefun-board.ts`, `lib/model.ts`, `lib/types.ts`, `main.ts`, `board.json`, `data.js` | None | DONE |
| M2 | Token Launch Radar Web Dashboard | `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` | M1 (for data schema) | IN_PROGRESS |
| M3 | Competition Deliverables & Packaging | `scripts/capture-screenshots.py`, `screenshots/*.png`, `LICENSE`, `dossier.json` validation | M1, M2 | PLANNED |
| M4 | Final Milestone: 100% E2E Verification & Hardening | Phase 1: Pass 100% E2E test suite (Tiers 1-4). Phase 2: Adversarial hardening (Tier 5). | M1, M2, M3, E2E Track | PLANNED |

---

## Interface Contracts

### Data Pipeline ↔ Dashboard & Evaluator
- `SnapshotProtocol`: `{ slug: string, name: string, category: string | null, chains: string[], tvl_usd: number, change_7d: number | null, mcap_usd: number | null, listed_at: string | null, gecko_id: string | null, symbol: string | null }`
- `BoardRow`: `{ slug: string, name: string, rank: number, implied_value_usd: number, farm_steps: string[] }`
- `board.json`: `{ rows: BoardRow[] }` where `rows.length === 200`, `rank === index + 1`, and `implied_value_usd` is monotonically non-increasing.
- `data.js`: Declares `window.RADAR = { as_of: string, protocols: RadarProtocol[], watchlist_slugs: string[], live_comps: LiveComp[], summary: RadarSummary };`.
- `DossierCaps`: `{ text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524288 }, dashboard: { max_files: 400, max_bytes: 4194304 } }`.

### Dashboard ↔ Screenshot Pipeline
- URL: `file:///.../dashboard/index.html`
- Selectors:
  * Default Board View: captured at load time.
  * Protocol Detail View: click `tbody tr:first-child` or `button[data-action="detail"]`, wait 300ms for `<dialog>` slide transition.
  * Filtered View: close dialog, set `#category` to "RWA", `#q` to "solana", wait 300ms.
- Dimensions: Exactly 1440 x 900 pixels.
- Output: `screenshots/1-board.png`, `screenshots/2-detail.png`, `screenshots/3-filtered.png`.

---

## Code Layout
```
token-radar-01/
├── LICENSE                    # OSI MIT license with SPDX header
├── package.json               # {"name": "token-radar-01", "type": "module", "version": "1.0.0"}
├── main.ts                    # Entrypoint executable under Node 22 (node /bot/main.ts)
├── vendor/
│   └── makefun-board.ts       # Byte-for-byte copy from kit
├── lib/
│   ├── types.ts               # Complete TypeScript interfaces
│   └── model.ts               # "radar-2" valuation engine & 6-step farm plan playbook
├── dashboard/
│   ├── index.html             # Clean offline semantic HTML (< 3 KB)
│   ├── app.css                # Dark Swiss terminal styling, sub-300ms transitions (< 16 KB)
│   └── app.js                 # Dense interactive table, drawer, multi-facet filter (< 26 KB)
├── screenshots/
│   ├── 1-board.png            # 1440x900 PNG cover board
│   ├── 2-detail.png           # 1440x900 PNG protocol detail drawer
│   └── 3-filtered.png         # 1440x900 PNG filtered view
├── scripts/
│   └── capture-screenshots.py # Deterministic headless Chrome capture script
└── tests/
    └── e2e-gate-runner.mjs    # Comprehensive E2E test suite (Tiers 1-4)
```
