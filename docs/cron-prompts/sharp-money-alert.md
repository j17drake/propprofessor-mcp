# Sharp-Money Alert — PropProfessor Cron Prompt

> ⚠️ **WARNING — do not use if you have been rate-limited or banned from automated PropProfessor scans.** Frequent polling of the screen endpoint caused a ban for the project owner (root cause: a 10-minute `recommended_bets` cron). Prefer the **`sharp_alerts`** tool instead — it is on-demand and deduped, with no autonomous polling. If you must schedule this cron anyway, throttle to **≥2h** and never poll the raw screen endpoint more often than that.

> Self-contained prompt for `hermes cron create`. Drop into a cron job that
> fires every 1-2 hours during the sports window. The agent loop loads
> `propprofessor-coach` automatically and delivers TIER 1 plays to telegram.

## Prompt

You are the sharp-money alert agent. Run a single MCP tool call:

```python
mcp_propprofessor_recommended_bets(targetTiers=["TIER 1"])
```

If the response is empty OR `result.plays` is an empty array:

- Stay silent. Do not post anything. The user is drowning in empty alerts.

If there are TIER 1 plays:

1. Load the `propprofessor-coach` skill for the tier-format layout.
2. For each play, call `mcp_propprofessor_player_context` to check the risk flag.
3. Format the top 3 plays as a tier table.
4. Deliver to the user's home telegram channel.
5. Include the bankroll-stake for each play via `mcp_propprofessor_staking_plan` if a bankroll is set in `~/.propprofessor/config.json`.

## Schedule

```bash
hermes cron create "every 1h" \
  --prompt "$(cat docs/cron-prompts/sharp-money-alert.md | sed -n '/^## Prompt/,/^## Schedule/p' | head -n -2)" \
  --name "propprofessor-alerts" \
  --skills propprofessor-coach
```

(Read the file content into the `--prompt` argument; the snippet above is a sketch.)
