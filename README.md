# Token Launch Radar (`token-radar-01`)

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kevinms02/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kevinms02/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An institutional-grade DeFi Token Launch Radar built for the [make.fun](https://make.fun) `token-radar-01` competition.

## Overview
Token Launch Radar discovers high-potential pre-token DeFi protocols, estimates an objective quantitative implied valuation (Implied FDV), and synthesizes actionable, costed farming playbooks for capital allocators and airdrop participants.

## Quantitative Valuation Model
The valuation engine evaluates protocols using a multi-factor methodology calibrated against historical DeFi token generation events:

$$\text{Implied Value USD} = \max\left(100\,000, \mathrm{round}\left(\text{TVL} \times M_{\text{cat}} \times V_{\text{7d}} \times L_{\text{age}} \times C_{\text{mult}}\right)\right)$$

1. **Category Multiple ($M_{\text{cat}}$)**:
   - Derivatives / Perps / Options: $1.20 \times$ (high capital velocity, fee yield)
   - Lending / CDP: $0.65 \times$ (stable asset retention)
   - Dexes / AMMs: $0.80 \times$ (trading volume, swap fee distribution)
   - Yield / Liquid Restaking: $0.40 \times$
   - Cross-chain / Infrastructure: $0.90 \times$
   - Default / Other: $0.50 \times$

2. **TVL Velocity & Momentum ($V_{\text{7d}}$)**:
   - Clamped 7-day TVL change $[-50\%, +150\%]$:
     $$V_{\text{7d}} = 1.0 + \left(\frac{\text{clamp}(\Delta_{7\text{d}}, -50, 150)}{100} \times 0.40\right)$$

3. **Maturity & Lindy Effect ($L_{\text{age}}$)**:
   - Protocol operational durability:
     $$L_{\text{age}} = 0.70 + 0.30 \times \left(\frac{\min(\text{age\_days}, 730)}{730}\right)$$

4. **Multichain Expansion Premium ($C_{\text{mult}}$)**:
   - Cross-network liquidity reach:
     $$C_{\text{mult}} = 1.0 + \min(\text{chains.length} - 1, 5) \times 0.05 \quad [1.00 - 1.25]$$

## Features
- **100% Watchlist Guarantee**: Complete coverage of all 40 protocols ($TVL \ge \$50M$ without token) plus the top 160 pre-token protocols, ranking 200 high-signal rows monotonically.
- **Dynamic Farming Playbook**: 4-8 concrete, costed steps per protocol with estimated gas costs, lockups, and interaction frequencies (strictly 40-250 characters each).
- **Zero-Dependency Dark Bento Dashboard**: Standalone static HTML5/CSS/JS frontend (<45 KB source) that renders locally with zero external network requests.
- **Offline Gate Compliance**: Fully passes all 7 server container gate checks (`dashboard_files`, `board_file`, `sorted_by_value`, `coverage`, `farm_steps`, `screenshots`, `dossier_matches`).

## Running & Verification
```bash
# Generate board, dashboard data, and dossier
node --experimental-strip-types main.ts --input input/snapshot.json --output out

# Run verification test suite
node --experimental-strip-types scripts/verify-submission.ts --output out
```

## License
MIT
