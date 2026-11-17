# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hHuntersec/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hHuntersec/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for the [make.fun bounty "Build the best token launch radar"](https://make.fun/bounty/token-radar-01).

## What it does

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot
of every protocol it tracks, works out which ones still record no token and are
not a wrapped or staked product of one that trades, and ranks them by what
their launch would be worth. It writes a 198-row board (40 watchlist + 158
early protocols, $3.54B of implied value in all) and a static dashboard with
the board, a detail view for each protocol, filters, and the steps to farm it.

## Method

- The watchlist's exclusion rule applies to every row: bridges, liquid
  staking/restaking and wrapped products of tokens that already trade are
  never ranked.
- No TVL cap on early rows, so genuine pre-token protocols the starter
  crowded out are ranked — headlined by Sentora Curator ($2.76B TVL) at #2.
- Each category's multiple is the median market-cap/TVL of its tokenized
  peers in the snapshot, shrunk toward the global median — Dexs x0.30,
  Lending x0.15, RWA x0.25, Basis Trading x0.47 — instead of a flat 0.25.
  Growth (clamped 7d change) and maturity (age with no token) shape the
  value; no name is ever special-cased.
- Farm plans carry concrete steps with chain-specific gas costs and times.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Reads the snapshot and writes the board (`board.json`), the dashboard data
(`data.js`), the dashboard and screenshots, and the judge's dossier
(`dossier.json`) into the output directory. Two runs write byte-identical
output.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
