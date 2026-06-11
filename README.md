# PropProfessor MCP

> An MCP server that shows you what the sharp money is doing. 27 tools that screen 36 sportsbooks, detect sharp movement, surface line moves, and explain the consensus — so you can decide what to bet, not be told.

[![Release](https://img.shields.io/github/v/release/j17drake/propprofessor-mcp?color=44cc11)](https://github.com/j17drake/propprofessor-mcp/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/j17drake/propprofessor-mcp/ci.yml?branch=main&label=ci)](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-775%20passing-44cc11)](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-82%25-44cc11)](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-18%2B-44cc11)](https://img.shields.io/badge/node-18%2B-44cc11)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Connect it to Claude Desktop, Cursor, Cline, or any MCP client. Your agent gets 27 tools to screen odds across 36 books, detect coordinated sharp movement, surface steam moves and line lags, and explain why a play is being flagged — all backed by the actual data, not a black-box prediction. It needs a [PropProfessor](https://propprofessor.com) account to work.

**Honest scope:** PropProfessor MCP is a **sharp-money signal feed**, not a betting oracle. The ranking pipeline reliably detects _what sharp books are doing_ (line moves, consensus, steam, independent sharp confirmation) — it does **not** reliably predict _which side will win_. The TIER 1/2/3/4 system is a quality rating on the signal strength, not a confidence claim about outcomes. Use it as a tool to inform your own handicapping, not to outsource your decisions.

---

## See it in action

Ask your agent: _"Show me the strongest coordinated sharp-money signals on tonight's NBA slate."_

```json
{
  "ok": true,
  "result": {
    "plays": [
      {
        "tier": "TIER 1",
        "kaiCall": "BET",
        "game": "Lakers @ Celtics",
        "market": "Moneyline",
        "selection": "Lakers ML",
        "odds": -135,
        "edge": 4.2,
        "riskScore": 1.8,
        "rationale": "Pinnacle + Circa both moved -142 → -135 over 90 min. Steam confirmed on 3 books. 5+ book consensus. No injury flag."
      },
      {
        "tier": "TIER 2",
        "kaiCall": "CONSIDER",
        "game": "Warriors @ Nuggets",
        "market": "Spread",
        "selection": "Warriors +3.5",
        "odds": -110,
        "edge": 2.1,
        "riskScore": 3.4,
        "rationale": "Single-window sharp move on DraftKings. Modest consensus. Player context clean."
      }
    ],
    "marketsBreakdown": { "Moneyline": 3, "Spread": 1, "Total": 0 }
  },
  "resultMeta": {
    "tierCounts": { "TIER 1": 1, "TIER 2": 1, "TIER 3": 0, "TIER 4": 0 }
  }
}
```

That's the output your agent gets. The `tier` is the **signal quality rating** (1 = highest signal strength, 4 = no real signal). The `riskScore` is 1–10 (lower = cleaner). The `rationale` tells you _what sharp books are doing_ — not what will happen. The `kaiCall` and tier are quality assessments of the movement data, not predictions about outcomes. Use them to decide what to investigate further; the call on whether to act is yours.

---

## The numbers

The ranking pipeline is validated against synthetic scenarios where the movement signals and the outcomes are both known, plus real-world snapshots as the daily cron collects resolved data. The numbers below measure **signal quality** (does the system correctly identify what sharp money is doing?) — not predictive power (which side wins). Predictive claims have been removed from this README; see the [methodology section](#how-the-ranking-works) for the full math.

| What we measure                          | Result                                                                        |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| Tier ordering (does TIER 1 beat TIER 4?) | **Yes** — TIER 4 has the lowest hit rate, TIER 1 the highest                  |
| TIER 1 vs TIER 3 hit rate gap            | **+0.3 to +3.1pp** — system differentiates weakly                             |
| TIER 1 hit rate (synthetic)              | **~50%** — the system flags real movement but doesn't beat chance on outcomes |
| TIER 4 > TIER 2 inversion                | **Fixed in v1.5.1**, held in v1.5.5 — TIER 4 ≤ TIER 2                         |
| Steam move detection                     | Coordinated sharp moves across 3+ books within a 90-min window                |
| Line lag detection                       | Target-book price divergence vs sharp consensus (avg 12-25pt gap)             |
| Tests                                    | **775 passing**                                                               |
| Coverage                                 | **82% statements, 88% functions**                                             |

The tier system isn't magic. It's a transparent scoring formula that combines movement grade (green/yellow/red), risk score (1–10 weighted factors), and historical tier trajectory. You can read every line of the math in [`lib/propprofessor-risk-score.js`](lib/propprofessor-risk-score.js). See [How the ranking works](#how-the-ranking-works) for the full methodology.

**What this means in practice:** when the system flags a TIER 1 play, you can trust that:

- Multiple sharp books are moving in a coordinated direction (not noise)
- The target book is meaningfully stale (positive edge was real at one point)
- The risk factors (steam, consensus, execution quality) all line up

What you **can't** trust from the system alone: that the side it flags will win. The signal is reliable; the outcome prediction is not. Your job is to take the signal and decide.

---

## What you can ask your agent

A few real prompts, by use case:

**Sharp money movement**

- "What are tonight's strongest coordinated sharp moves across NBA and NHL?"
- "Show me spread plays where sharp books have moved together."
- "Where are sharp books and the public disagreeing the most right now?"
- "Is there a steam move on the Cowboys game in the last hour?"

**Line shopping and lag detection**

- "Where is the price lag between target books and sharp books biggest right now?"
- "Line-shop my top 3 flagged plays and tell me where the price is best."
- "Show me consensus across Pinnacle, Circa, and BookMaker for tonight's MLB slate."

**Signal validation and context**

- "Show me the rationale for why this play was flagged TIER 1."
- "Any injury flags on the Lakers backcourt tonight?"
- "Check player context for the top 3 flagged plays tonight."

**Tracking your own work (optional)**

- "Log this pick — Warriors +3.5 at -110."
- "What's my P&L this week?"

The first three sections are the data tool's core. The last section is optional bet-tracking — it works if you want it, but the system isn't telling you to place any of those bets.

---

## Install (60 seconds)

```bash
git clone https://github.com/j17drake/propprofessor-mcp.git
cd propprofessor-mcp
npm install
npm link
pp-query login       # opens a browser, log into PropProfessor
pp-query doctor     # confirms everything's wired up
```

You now have two commands:

| Command    | Purpose                                             |
| ---------- | --------------------------------------------------- |
| `pp-mcp`   | MCP server (stdio) — what your AI agent connects to |
| `pp-query` | CLI for setup, debug, quick checks                  |

**Requirements:** Node 18+, a paid [PropProfessor](https://propprofessor.com) account, ~5 minutes. Full walkthrough in [SETUP.md](SETUP.md).

---

## MCP client setup

### Hermes Agent

```yaml
mcp_servers:
  propprofessor:
    command: node
    args:
      - /path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js
    enabled: true
    env:
      AUTH_FILE: /path/to/.propprofessor/auth.json
      PROPPROFESSOR_MCP_NDJSON: 'true'
```

### Claude Desktop / Cursor / Cline / Zed

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "AUTH_FILE": "/path/to/.propprofessor/auth.json",
        "PROPPROFESSOR_MCP_NDJSON": "true"
      }
    }
  }
}
```

Replace the path with wherever you cloned the repo. Token compression (smaller context for large responses) — install `caveman-shrink` globally and use `command: caveman-shrink` with `node` + server path in `args`.

---

## All 27 tools (reference)

### For quick situational checks (the 5-minute scan)

|| Tool | What it does |
|| ---------------------------------------- | --------------------------------------------------------- |
|| `get_started(user_type: "casual")` | Returns the casual workflow (3 tools) |
|| `recommended_bets(verbosity: "minimal")` | Top flagged movements in plain English |
|| `player_context` | Injury/availability check on specific plays |
|| `get_pick_stats` | Your win rate + P&L (only meaningful if you've logged picks) |
|| `log_pick` / `resolve_pick` | Track your own bet outcomes (optional) |
|| `health_status` | "Is the system up?" |

### For deeper signal analysis (what sharp books are doing)

Everything in casual, plus:

|| Tool | What it does |
|| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
|| `recommended_bets(verbosity: "standard")` | Flagged plays with tier, risk score, movement rationale |
|| `find_best_price` | Line-shop across all books for the best price |
|| `league_presets` | Sport-specific ranking weights |
|| `novig_screen` | NoVigApp-specific screen |
|| `hide_bet` / `unhide_bet` / `clear_hidden_bets` / `get_hidden_bets` | Manage flagged-play visibility |
|| `get_pick_history` | View logged picks |

### For full raw data and research (complete control over the signal)

Everything above, plus:

|| Tool | What it does |
|| ---------------------------------- | --------------------------------------------------------------------------------------- |
|| `screen_ranked(verbosity: "full")` | Complete ranked data with movement signals |
|| `sharp_consensus` | Multi-window sharp movement (1h–48h) |
|| `sharp_plays` | Plays with **independent sharp confirmation** across Pinnacle/Circa/BookMaker/BetOnline |
|| `get_play_details` | Line history for specific games |
|| `staking_plan` | Fractional Kelly sizing for picks you decide to place (TIER 1: 2%, TIER 2: 1% of bankroll) |
|| `screen_raw` | Raw odds payload, no ranking — for when you want to do your own analysis |
|| `ev_candidates` | Fast +EV discovery (validate on `/screen` after) |
|| `all_slates` | Consolidated ranked list across multiple leagues |
|| `screen` | League-specific screen (NBA, MLB, NHL, NFL, WNBA, UFC, Tennis, Soccer, NCAAB, NCAAF) |
|| `get_alerts` | Line movement alerts |

### Tool guide by category

|| Category | Tools |
|| ----------------------- | ------------------------------------------------------------------------------------------------------ |
|| **Screening & Ranking** | `screen_ranked`, `screen`, `screen_raw`, `all_slates`, `get_play_details` |
|| **Sharp Movement** | `sharp_plays`, `sharp_consensus` |
|| **Flagged Plays** | `recommended_bets`, `staking_plan`, `ev_candidates` |
|| **Line Shopping** | `find_best_price` |
|| **Player Context** | `player_context` |
|| **UFC** | `ufc_card` |
|| **Bet Management** | `hide_bet`, `unhide_bet`, `clear_hidden_bets`, `get_hidden_bets` |
|| **Picks & Tracking** | `log_pick`, `resolve_pick`, `get_pick_history`, `get_pick_stats`, `get_alerts`, `clear_score_timeline` |
|| **Meta** | `get_started`, `health_status`, `league_presets` |

Every tool accepts a `verbosity` param (`"minimal"` / `"standard"` / `"full"`) and a `compact: true` flag to shrink responses by ~90%. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for response-size tuning.

---

## How the ranking works

The system assigns every play a **tier** (1–4) and a **risk score** (1–10). Here's exactly how.

### Step 1: Grade the movement

Each play gets a **movement grade**: green, yellow, or red. Green means all these are true:

- Supportive movement direction (sharp books moving the same way)
- High movement quality (score ≥ 0.8)
- Acceptable execution quality (best or playable)
- Strong consensus (5+ books agree)
- Strong steam signal or high movement quality
- Positive CLV (closing line value proxy)
- Sustained agreement across 4+ of 6 time windows (1h, 2h, 6h, 12h, 24h, 48h)

Red means any of: adverse movement, or bad execution with thin consensus. Everything else is yellow.

### Step 2: Score the risk

A weighted score, base 5, modified by:

| Factor                | Modifier |
| --------------------- | -------- |
| Movement green        | −2       |
| Movement red          | +3       |
| Edge > 2%             | −1       |
| Edge > 0.5%           | 0        |
| Edge < 0.5%           | +1       |
| No edge               | +2       |
| Consensus ≥ 10 books  | −1       |
| Consensus 3–9 books   | 0        |
| Consensus 1–2 books   | +1       |
| Execution best        | −1       |
| Execution playable    | 0        |
| Execution bad/unknown | +2       |
| Supportive steam      | −1       |
| Adverse steam         | +3       |
| CLV > 0               | −1       |
| CLV < −3              | +2       |

Final score: 1 (cleanest) to 10 (riskiest).

### Step 3: Assign the tier

| Grade                | Risk score | Tier                          |
| -------------------- | ---------- | ----------------------------- |
| Green                | ≤ 2        | TIER 1                        |
| Green                | 3–4        | TIER 2                        |
| Green                | 5–6        | TIER 2 (promoted from TIER 3) |
| Green                | 7+         | TIER 3                        |
| Yellow               | ≤ 4        | TIER 2                        |
| Yellow               | 5–6        | TIER 3                        |
| Yellow               | 7+         | TIER 4                        |
| Red or PASS kai call | any        | TIER 4                        |

### Step 4: Hysteresis

`getConfidenceTierStable()` wraps the raw tier in a hysteresis layer so a play doesn't bounce between TIER 2 and TIER 3 every time odds shift by 1 cent. The stable tier only updates if:

- The raw tier differs by 2+ levels from the cached tier, OR
- The risk score moves by 3+ points

Plus a 2-hour rolling window — the returned tier is the mode of all raw tiers observed in the last 2 hours, which captures the trajectory.

### Step 5: Sharp book cross-reference

For `sharp_plays` and `recommended_bets`, each play is cross-referenced against individual sharp book screens (Pinnacle, Circa, BookMaker, BetOnline). A play only gets `Bet candidate` status if a non-target sharp book **independently** shows supportive movement on the same game+selection. This filters out target books whose own self-sourced movement is unreliable.

### The kaiCall

The kaiCall is a one-word summary your agent should use to decide what to do:

| kaiCall    | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `BET`      | Strong signal across all dimensions. TIER 1 + clean. |
| `CONSIDER` | TIER 2 with acceptable risk. Worth looking at.       |
| `PASS`     | TIER 3/4, or red flags present. Skip.                |

---

## Backtesting

The tier system gets validated two ways:

**1. Synthetic backtest** — generates scenarios with known outcomes (3 distinct types: `sharp_move` where target book is stale, `stable_no_edge` where all books agree, `adverse` where sharp books move against). Runs the full ranking pipeline. Reports per-tier hit rates. Run it:

```bash
node scripts/backtest-synthetic.js
```

**2. Daily snapshot** — a cron job captures pre-game odds daily, stores snapshots to `backtest-data/`. As games resolve, hit rates get measured against real outcomes over time. The snapshot cron is in `scripts/backtest-daily-snapshot.js`.

**What we look for:**

- TIER 1 hit rate > 60% — healthy
- TIER 1 ≈ TIER 3 — tier system isn't differentiating
- TIER 4 > TIER 2 — red flags are wrong (this was the v1.5.1 fix)

Full methodology in [docs/BACKTESTING.md](docs/BACKTESTING.md).

---

## Status

**Actively maintained.** Last release: see [releases](https://github.com/j17drake/propprofessor-mcp/releases). Live runtime status: check the [CI badge](https://github.com/j17drake/propprofessor-mcp/actions/workflows/ci.yml) — green means main is green, 775 tests passing.

The repo runs a nightly live-smoke workflow that hits the real PropProfessor API and validates end-to-end behavior. Failures show up as red on the Actions tab.

If you hit an issue, run `pp-query doctor` first — it diagnoses most setup problems. Persistent issues → [open a GitHub issue](https://github.com/j17drake/propprofessor-mcp/issues) with the output of `pp-query doctor` and `node --version`.

---

## Support this project

This is a free, MIT-licensed MCP. If it saves you time or makes you money, consider:

- ⭐ Star the repo — helps others find it
- 🐛 [Open an issue](https://github.com/j17drake/propprofessor-mcp/issues) when you find a bug
- 💸 [Sponsor on GitHub](https://github.com/sponsors/j17drake) — funds ongoing development

No paid tier. No upsell. The whole codebase is open and the priority is making it better for the people who use it.

---

## For maintainers

- **Tests**: `npm test` (775 passing) — 5/5 reruns, deterministic
- **Coverage**: `npm run test:coverage` (~82% statements, ~88% functions)
- **Lint**: `npm run lint` (clean)
- **Format**: `npm run format:check` (clean — `npm run format` to fix)
- **Version check**: `npm run check:version` (verifies package.json ↔ CHANGELOG consistency)
- **Live smoke**: `npm run smoke:live` (requires `auth.json`)
- **Release**: Push a `v*` tag → GitHub Actions runs lint + tests on Node 20 + 22, then auto-creates the GitHub release
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
- **Tool definitions**: `lib/propprofessor-tool-definitions.js`
- **Tier methodology**: `lib/propprofessor-risk-score.js`
- **Ranking logic**: `lib/screen-ranker.js`

Detailed docs:

- [SETUP.md](SETUP.md) — install, auth, MCP client configs, troubleshooting
- [AUTH.md](AUTH.md) — auth flow, file locations, session management
- [CONFIG.md](CONFIG.md) — env vars, book configuration
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to add a tool, PR conventions
- [SECURITY.md](SECURITY.md) — auth handling, threat model
- [MAINTAINERS.md](MAINTAINERS.md) — release process, code ownership
- [docs/BACKTESTING.md](docs/BACKTESTING.md) — tier validation methodology
- [docs/MARKET-BOOK-AVAILABILITY.md](docs/MARKET-BOOK-AVAILABILITY.md) — which books post which markets
- [docs/HERMES_SKILL.md](docs/HERMES_SKILL.md) — Hermes skill for this MCP
- [docs/AGENT_PROMPT.md](docs/AGENT_PROMPT.md) — system prompt template for agents

---

## License

[MIT](LICENSE) — see LICENSE for the full text. PropProfessor is a paid service; this MCP is an unofficial client built by [j17drake](https://github.com/j17drake), not affiliated with PropProfessor.
