# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kevinms02/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kevinms02/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Institutional-grade pre-token valuation radar and actionable farm execution system for DeFi protocols, built for make.fun competition #3 (`token-radar-01`).

## Overview

- **Watchlist Coverage**: 100% (40/40 protocols)
- **Universe**: 200 ranked pre-token protocols strictly ordered by comps-calibrated implied FDV
- **Actionable Execution**: 6-step farm playbooks per protocol with capital allocation, gas budgets, and security/unwind guidelines
- **Offline Dashboard**: Dark Swiss/terminal interface under 40 KB with zero external dependencies and instant hash-based routing

## Execution

```bash
node --experimental-strip-types main.ts --input input/snapshot.json --output ./out
```

## License

OSI Approved [MIT](LICENSE)
