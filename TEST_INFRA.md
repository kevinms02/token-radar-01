# E2E Test Infra: make.fun Competition #3 Token Launch Radar (token-radar-01)

## Test Philosophy
- **Opaque-Box & Requirement-Driven**: Tests validate pure user and competition requirements from `ORIGINAL_REQUEST.md`, `RULES.txt`, `competition.yaml`, and the authoritative competition kit, without relying on internal function implementations.
- **Strict Anti-Cheating & Integrity**: Verifies genuine calculations, realistic farm steps, dynamic valuation modeling, and zero hardcoded fake data.
- **Local Simulation of Competition Sandbox**: Replicates Docker container execution limits (1 CPU, 1024 MB RAM, <= 64 PIDs, 120s timeout, read-only `/bot`, clean `/output`), consecutive run determinism, and the exact 7 competition gate checks.
- **Methodology**: Systematic 4-Tier Test Design (Category-Partition, Boundary Value Analysis, Pairwise Combinatorial Testing, Real-World Sandbox Workload Simulation).

---

## Feature Inventory & Test Mapping

| # | Feature Name | Requirement Source | Tier 1 (Feature) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Workload) |
|---|---|---|:---:|:---:|:---:|:---:|
| 1 | `main.ts` CLI & Sandbox Execution | `RULES.txt` l.104 | 5 cases | 5 cases | ✓ | ✓ (T4.1) |
| 2 | Consecutive Run Determinism | `RULES.txt` l.105 | 5 cases | 5 cases | ✓ | ✓ (T4.2) |
| 3 | Watchlist Extraction (40 items) | `RULES.txt` l.16 | 5 cases | 5 cases | ✓ | ✓ (T4.4) |
| 4 | Pre-Token Universe Ingestion | `RULES.txt` l.25 | 5 cases | 5 cases | ✓ | ✓ |
| 5 | Comps-Calibrated Valuation Model | `competition.yaml` Rubric 2 | 5 cases | 5 cases | ✓ | ✓ |
| 6 | Actionable Farm Plan Playbook | `competition.yaml` Rubric 3 | 5 cases | 5 cases | ✓ | ✓ (T4.4) |
| 7 | `board.json` Structure & Rank | `RULES.txt` l.24-25 | 5 cases | 5 cases | ✓ | ✓ (T4.4) |
| 8 | Monotonic Non-Increasing Sort | `RULES.txt` l.31-32 | 5 cases | 5 cases | ✓ | ✓ (T4.4) |
| 9 | Out-of-Dashboard Data Decoupling | `vendor/makefun-board.ts` l.268 | 5 cases | 5 cases | ✓ | ✓ |
| 10 | Offline Dashboard Shell | `ORIGINAL_REQUEST.md` R1 | 5 cases | 5 cases | ✓ | ✓ (T4.3) |
| 11 | Strict Zero-Network Enforcement | `RULES.txt` l.22 | 5 cases | 5 cases | ✓ | ✓ (T4.3) |
| 12 | Anti-AI-Slop & Kowalski Polish | `ORIGINAL_REQUEST.md` R1 | 5 cases | 5 cases | ✓ | ✓ |
| 13 | Main Board View & KPI Cards | `competition.yaml` Rubric 4 | 5 cases | 5 cases | ✓ | ✓ |
| 14 | Protocol Detail Sliding Drawer | `competition.yaml` Rubric 4 | 5 cases | 5 cases | ✓ | ✓ |
| 15 | Multi-Facet Filter Controls | `ORIGINAL_REQUEST.md` R1 | 5 cases | 5 cases | ✓ | ✓ |
| 16 | Live Token Comps View | `competition.yaml` Rubric 2 | 5 cases | 5 cases | ✓ | ✓ |
| 17 | Headless Screenshot Pipeline | `RULES.txt` l.34 | 5 cases | 5 cases | ✓ | ✓ (T4.4) |
| 18 | Canonical Dossier & OSI License | `RULES.txt` l.35, l.108 | 5 cases | 5 cases | ✓ | ✓ (T4.4) |
| **Total** | **18 Features** | | **≥ 90 cases** | **≥ 90 cases** | **10 scenarios** | **5 scenarios** |

---

## Test Architecture

### 1. Test Suite Layout
```
token-radar-01/
├── tests/
│   ├── e2e-gate-runner.mjs        # Main CLI entrypoint running Tiers 1-4 with diagnostic reporting
│   ├── harness/
│   │   ├── gate-evaluator.mjs     # The exact 7 sealed competition gate checks
│   │   ├── sandbox-runner.mjs     # Docker/CLI execution harness with memory and timing profiling
│   │   ├── offline-auditor.mjs    # Static HTML/CSS/JS zero-network and anti-AI-slop scanner
│   │   └── dom-evaluator.mjs      # Headless DOM interaction and multi-facet filter tester
│   └── fixtures/
│       ├── corrupt-snapshot.json  # Missing required keys for fault-injection testing
│       └── mock-protocols.json    # Controlled boundary conditions (nulls, extremes, 0 TVL)
├── TEST_INFRA.md                  # Test architecture specification (this document)
└── TEST_READY.md                  # Published test completion signal & invocation guide
```

### 2. Invocation Command & Semantics
- **Execution Command**:
  ```bash
  node tests/e2e-gate-runner.mjs
  ```
- **Optional Tier Targeting**:
  ```bash
  node tests/e2e-gate-runner.mjs --tier=1
  node tests/e2e-gate-runner.mjs --tier=2
  node tests/e2e-gate-runner.mjs --tier=3
  node tests/e2e-gate-runner.mjs --tier=4
  node tests/e2e-gate-runner.mjs --gate-only
  ```
- **Exit Codes**:
  - `0`: 100% of selected tests pass; all 7 gate checks PASS; Valid = 1.
  - `1`: One or more tests failed or gate check failed. Emits detailed failure diagnostics.

---

## 4-Tier Test Case Design Specification

### Tier 1: Feature Coverage (≥5 Tests per Feature, Total ≥90 Tests)
Covers all 18 features directly from requirements:
1. `main.ts` CLI execution with `--input` and `--output` flags.
2. Default environment variable `MAKEFUN_OUTPUT_DIR` handling.
3. Execution timeout safety (runs in < 15s, container limit 120s).
4. Watchlist protocol extraction (all 40 pre-token protocols).
5. Pre-token vs. Live-token protocol segregation.
6. Valuation formula multi-factor arithmetic (base multiple, growth, maturity).
7. Actionable farm step structure (3 to 12 steps, opsec, capital tiers, holding window).
8. `board.json` generation (200 rows, valid slugs, positive safe integer implied values).
9. Contiguous 1..N ranking without gaps or duplicates.
10. Monotonically non-increasing sorting (`row[i].implied <= row[i-1].implied`).
11. Decoupled `data.js` written outside `dashboard/` to `/output/data.js`.
12. Dashboard total source code size < 65,536 bytes (avoiding dossier truncation).
13. Dashboard semantic HTML structure with skip links and `<dialog>` drawer.
14. Anti-AI-slop styling (zero emojis, custom cubic-bezier transitions <= 300ms, active scale 0.97).
15. Tabular numbers applied to all financial metrics.
16. KPI card rendering (Watchlist 40, Early 160, Total 200, Live Comps 24).
17. Multi-facet filtering (text search, category, chain, valuation tier).
18. Live token comps view rendering (24 protocols with Mcap/TVL multiples).
19. Headless screenshots (3 images: `1-board.png`, `2-detail.png`, `3-filtered.png`, 1440x900, <= 512 KiB).
20. Canonical `dossier.json` byte-for-byte fidelity with `buildDossier`.
21. Root `LICENSE` compliance with `SPDX-License-Identifier: MIT`.
22. The 7 sealed competition gates evaluated individually.

### Tier 2: Boundary & Corner Cases (≥5 Tests per Group, Total ≥90 Tests)
Stresses input boundaries, edge cases, and numerical limits:
1. **Snapshot Data Nulls & Fallbacks**:
   - `change_7d === null` falls back to 0.0% without NaN propagation.
   - `listed_at === null` falls back to default 365 days maturity.
   - `category === null` defaults to "DeFi" gracefully.
   - Empty chains array or multi-chain array handled without layout breakage.
2. **Growth Velocity Clamping**:
   - Extreme negative change (`-72.7%`) clamped to `-60.0%`.
   - Extreme positive change (`+4448.5%`) clamped to `+120.0%`.
   - 0.0% change produces baseline growth multiplier.
3. **Maturity Curve Clamping**:
   - Age 0 days evaluates to minimum maturity floor `0.60`.
   - Age >= 1095 days evaluates to maximum maturity cap `1.00`.
4. **Implied Valuation Integer Limits**:
   - Lowest TVL protocol generates integer >= $1.
   - Highest TVL protocol ($116B) stays <= $100,000,000,000,000 ($100T).
   - Identical valuations tie-broken deterministically by slug.
5. **Farm Step Length & Count Enforcements**:
   - Trimmed string of exactly 20 chars passes; 19 chars padded.
   - Trimmed string of exactly 600 chars passes; >600 chars clamped.
   - Step counts at exactly 3 and 12 steps pass.
6. **Board Row Bounds**:
   - Rejection if board < 100 rows or > 4000 rows.
   - Rejection if all rows have identical implied value.
7. **Filter Edge Cases**:
   - Text search query with regex special characters (`(test) [solana] . *`).
   - Query matching 0 results shows clean empty state without crashing.
   - Category + Chain filters resulting in exactly 1 protocol.
8. **Dossier & Screenshot Limits**:
   - Screenshot size at boundary 524,288 bytes (512 KiB) passes; 524,289 bytes rejected.
   - Dossier size at boundary 1,572,864 bytes (1.5 MiB) passes.

### Tier 3: Cross-Feature Combinations (Pairwise Combinations)
Validates interactions across independent subsystems:
- `T3.1`: Category Filter + Column Sorting (filtered rows sorted cleanly, non-matches hidden).
- `T3.2`: Chain Filter + Free Text Search (compound multi-facet query narrowing).
- `T3.3`: Filter Active + Open Detail Drawer (drawer shows correct protocol, backdrop click or Esc preserves filter).
- `T3.4`: Detail Drawer + Keyboard Accessibility (Escape closes drawer, focus restored).
- `T3.5`: Tab Switching (Pre-Token Radar vs. Live Comps) preserves independent filter/search states.
- `T3.6`: Decoupled `data.js` loaded via `file:///` offline protocol renders full board with 0 network calls.
- `T3.7`: Monotonic Board Implied Valuation matches UI dynamic formula recalculation across all 200 rows.
- `T3.8`: Screenshot Capture pipeline captures exact filtered state for `3-filtered.png`.
- `T3.9`: Watchlist 100% Coverage holds simultaneously with strict Monotonic Descending Order.
- `T3.10`: `buildDossier` runs on generated dashboard + screenshots and produces `cover: 0` dossier <= 1.5 MiB.

### Tier 4: Real-World Workloads & Platform Sandbox Simulation
Replicates the exact platform judging environment:
- `T4.1: Sandbox Container Execution Simulation`:
  - Run `main.ts` with working directory simulated as read-only.
  - Writable output directory at `/output` (or temporary mock output folder).
  - Assert RSS memory < 256 MB and execution time < 15s.
- `T4.2: Consecutive 2-Run Determinism Verification`:
  - Execute `main.ts` into `test-run-1/` and `test-run-2/`.
  - Compare SHA-256 digests across all generated files (`board.json`, `data.js`, `dossier.json`, screenshots).
  - 100% byte-for-byte match required.
- `T4.3: Strict Zero-Network & Offline Audit`:
  - Scan HTML attributes, CSS rules, and JS imports for any `http://` or `https://`.
  - Verify zero runtime requests when loading `dashboard/index.html`.
- `T4.4: Local 7-Gate Validation Suite`:
  - Evaluate the 7 competition gates:
    1. `dashboard_files`: PASS
    2. `board_file`: PASS
    3. `sorted_by_value`: PASS
    4. `coverage`: PASS
    5. `farm_steps`: PASS
    6. `screenshots`: PASS
    7. `dossier_matches`: PASS
  - Output: `Valid = 1`.
- `T4.5: Fault-Injection & Corrupt Input Resilience`:
  - Missing snapshot input file exits 2 with diagnostic error.
  - Corrupt JSON structure handled with clean error exit.

---

## Pass/Fail Gate Definitions (The 7 Sealed Gate Checks)

1. **`dashboard_files`**:
   - `index.html` present under `dashboard/`.
   - At least one `.css` and at least one `.js` present.
   - Total files <= 400; total bytes <= 4,194,304 (4 MiB).
   - Filenames match `/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/`, no dot-directories.
   - ZERO occurrences of `http://` or `https://` in HTML attributes, style bodies, CSS, or JS imports.
2. **`board_file`**:
   - `board.json` is valid UTF-8 JSON.
   - `rows` array contains between 100 and 4,000 rows.
   - File size <= 8,388,608 bytes (8 MiB).
   - Every slug is unique, non-empty, contains no whitespace, and exists in `snapshot.json`.
   - `name` is non-empty string.
   - `rank` is integer >= 1.
   - `implied_value_usd` is positive integer $1 to $100T.
   - Implied values are not all identical.
3. **`sorted_by_value`**:
   - Ranks are contiguous 1 through N.
   - Implied value is monotonically non-increasing (`row[i] <= row[i-1]`).
4. **`coverage`**:
   - Exactly 100% of the 40 watchlist slugs from `snapshot.json` are present in `board.json`.
5. **`farm_steps`**:
   - Every row has 3 to 12 steps.
   - Each trimmed step is between 20 and 600 characters.
6. **`screenshots`**:
   - 3 to 4 images under `screenshots/` (PNG or JPEG).
   - Each file size <= 524,288 bytes (512 KiB).
   - Long side <= 1440 px, short side >= 800 px (standard: 1440x900).
7. **`dossier_matches`**:
   - `dossier.json` <= 1,572,864 bytes (1.5 MiB).
   - Byte-for-byte identical to `buildDossier('/output', { text_max_bytes: 65536 })`.
