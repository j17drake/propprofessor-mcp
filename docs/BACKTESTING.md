# Backtesting the Tier System

This document explains how to validate that the PropProfessor confidence tier
system (TIER 1 – TIER 4) actually predicts outcomes.

## Purpose

The tier system ranks plays by confidence:

| Tier   | Meaning                                                      |
| ------ | ------------------------------------------------------------ |
| TIER 1 | Green movement grade + low risk score (≤ 2). Strongest play. |
| TIER 2 | Green grade + moderate risk, or low risk without green.      |
| TIER 3 | Moderate risk score (3–7), no red flags.                     |
| TIER 4 | Red movement grade or PASS kai call. Avoid.                  |

The backtest script checks whether TIER 1 plays actually hit more often than
TIER 4 plays. If they don't, the tier methodology needs revision.

## Running the script

```bash
node scripts/backtest.js [league] [market] [days]
```

### Arguments

| Argument | Default     | Description                          |
| -------- | ----------- | ------------------------------------ |
| league   | `MLB`       | League name (e.g. `NBA`, `Tennis`)   |
| market   | `Moneyline` | Market type (e.g. `Spread`, `Total`) |
| days     | `30`        | Lookback window in days              |

### Examples

```bash
# Default: MLB Moneyline, last 30 days
node scripts/backtest.js

# NBA Moneyline, last 7 days
node scripts/backtest.js NBA Moneyline 7

# Tennis, all markets
node scripts/backtest.js Tennis Moneyline 14
```

## Understanding the output

```
Backtesting MLB Moneyline for the last 30 days...

Tier		Total	Wins	Losses	Push	Hit Rate
----		-----	----	------	----	--------
TIER 1		12	8	3	1	72.7%
TIER 2		24	14	9	1	60.9%
TIER 3		18	7	10	1	41.2%
TIER 4		6	1	5	0	16.7%

✓ Backtest complete.
```

- **Total**: Number of resolved bets in that tier
- **Wins / Losses / Push**: Outcome breakdown
- **Hit Rate**: Wins ÷ (Wins + Losses), excluding pushes

A healthy tier system shows monotonically decreasing hit rates from TIER 1 to
TIER 4.

## Limitations

### The screen endpoint returns current odds, not historical results

The PropProfessor `/screen` endpoint is designed for live odds screening. It
does not expose a "settled bets" feed. When the script finds no resolved bets,
it exits with `reason: no_historical_data`.

This is expected behavior — the API is not a historical database.

### Workarounds

1. **Run periodically and persist snapshots.** Use `scripts/export-ranked-screen.js`
   to save daily snapshots, then resolve outcomes against a separate results
   feed (e.g. a sports data API).

2. **Use the screen-history module.** The `propprofessor-screen-history` module
   can persist line history. Combine it with a results resolver to build a
   local backtest dataset.

3. **Manual tracking.** Run the script daily, log the TIER assignments, then
   check outcomes manually after games settle.

## What to look for

- **TIER 1 hit rate > 60%**: Strong signal. Trust the methodology.
- **TIER 1 hit rate ≈ TIER 3**: Tier system isn't differentiating. Review
  risk-score weights.
- **TIER 4 hit rate > TIER 2**: Red flags are wrong. Revisit movement grading.

## Related files

- `scripts/backtest.js` — the CLI script
- `lib/propprofessor-risk-score.js` — tier calculation logic
- `lib/propprofessor-screen-utils.js` — row extraction
- `scripts/export-ranked-screen.js` — snapshot exporter for manual tracking
