# Setup Guide — PropProfessor MCP

First time using an MCP server? This walks you through everything: install to first bet recommendation.

---

## What You're Getting

PropProfessor MCP is an odds analysis engine for AI agents. Connect it to Claude Desktop, Cursor, or any MCP client and your AI can:

- Screen live odds across 36+ sportsbooks
- Rank plays by sharp movement + consensus edge
- Detect steam moves and CLV shifts
- Line-shop for the best price on any bet
- Check player injuries and news before you bet
- Track your picks with win rate and P&L

It needs a paid [PropProfessor](https://propprofessor.com) account to work.

---

## 1. Install

### Prerequisites

- **Node.js 18+** — check: `node --version`
- **Git** — check: `git --version`
- **Paid PropProfessor account**

### Clone and install

```bash
git clone https://github.com/j17drake/propprofessor-mcp.git
cd propprofessor-mcp
npm install
npm link
```

That's it. Two commands available now:

| Command    | Purpose                                    |
| ---------- | ------------------------------------------ |
| `pp-mcp`   | MCP server for AI agents (stdio transport) |
| `pp-query` | CLI for login, debug, quick checks         |

---

## 2. Authentication (3 Steps)

### Step 1: Log into PropProfessor

**Automated (recommended):**

```bash
pp-query login
```

This opens a browser. Log into PropProfessor. Once you reach the dashboard, close the browser — your session is saved automatically.

> Requires Playwright. If it's not installed, run: `npx playwright install chromium`

**Manual (if automated fails):**

1. Log into PropProfessor in Chrome
2. Open DevTools → Application → Cookies
3. Export cookies as JSON → save as `auth.json`
4. Run: `pp-query install-auth --source /path/to/auth.json`

### Step 2: Verify

```bash
pp-query doctor
```

Expected output: all checks green.

### Step 3: You're authenticated

Auth file lives at `~/.propprofessor/auth.json`. It's good until your PropProfessor session expires (re-login when `doctor` starts failing).

---

## 3. Connect Your AI Client

Pick your client below. All configs go in that client's config file, then restart the client.

### Claude Desktop

**`claude_desktop_config.json`:**

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/full/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/Users/you/.propprofessor/auth.json"
      }
    }
  }
}
```

- Replace `/full/path/to` with your actual install path (e.g., `/Users/james/projects/propprofessor-mcp`)
- Restart Claude

---

### Cursor

**`.cursor/mcp.json`** (in your project root):

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/full/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/Users/you/.propprofessor/auth.json"
      }
    }
  }
}
```

---

### Zed

In Zed, go to Settings → MCP → Add Server:

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/full/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/Users/you/.propprofessor/auth.json"
      }
    }
  }
}
```

---

### Cline (VS Code extension)

**`cline_mcp_settings.json`:**

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/full/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/Users/you/.propprofessor/auth.json"
      },
      "disabled": false
    }
  }
}
```

---

### Continue.dev

**`~/.continue/config.json`:**

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/full/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/Users/you/.propprofessor/auth.json"
      }
    }
  }
}
```

---

### Windsurf

In Windsurf's MCP config:

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/full/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/Users/you/.propprofessor/auth.json"
      }
    }
  }
}
```

---

### Generic MCP Client (any stdio-based client)

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/full/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/Users/you/.propprofessor/auth.json"
      }
    }
  }
}
```

---

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

---

### Optional: Token Compression

Install `caveman-shrink` to shrink large responses:

```bash
npm install -g caveman-shrink
```

Then prefix your command with it:

```json
{
  "command": "caveman-shrink",
  "args": ["node", "/full/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"]
}
```

---

## 4. First Commands to Try

Once connected, ask your AI:

**Health check:**

> "Check if PropProfessor MCP is healthy."

**What's playable today:**

> "What are the top NBA plays right now?"

**Your personal stats:**

> "Show my pick history and win rate."

**Player check before betting:**

> "Any injury concerns for Giannis Antetokounmpo tonight?"

**Line shopping:**

> "What's the best price for Lakers moneyline across all books?"

**Line movement alerts:**

> "What's moved since I last checked?"

---

## 5. Tool Quick Reference

### Screening & Ranking

| Tool                       | When to use                                                    |
| -------------------------- | -------------------------------------------------------------- |
| `recommended_bets`         | **Start here.** TIER 1/2 plays across leagues with confidence. |
| `screen` / `screen_ranked` | Dive into a specific league's full ranked board.               |
| `all_slates`               | One call for all leagues at once.                              |
| `sharp_plays`              | Plays where a non-target sharp book confirmed the move.        |
| `sharp_consensus`          | Multi-window (1h-48h) sharp book consensus analysis.           |

### Player Context

| Tool             | When to use                                            |
| ---------------- | ------------------------------------------------------ |
| `player_context` | Injury/news check before any bet. Returns a risk flag. |

### Line Shopping

| Tool              | When to use                                                |
| ----------------- | ---------------------------------------------------------- |
| `find_best_price` | Every book's odds sorted best to worst for a specific bet. |

### Bet Management

| Tool               | When to use                               |
| ------------------ | ----------------------------------------- |
| `log_pick`         | Record a bet before tip-off.              |
| `resolve_pick`     | Mark it won/lost after the game.          |
| `get_pick_history` | View past picks with filters.             |
| `get_pick_stats`   | Your win rate and P&L by league and tier. |

### Alerts

| Tool         | When to use                                                                      |
| ------------ | -------------------------------------------------------------------------------- |
| `get_alerts` | Steam moves, CLV shifts, and fresh high-confidence plays since you last checked. |

### Staking

| Tool           | When to use                  |
| -------------- | ---------------------------- |
| `staking_plan` | Kelly sizing for your plays. |

### Meta

| Tool             | When to use                                    |
| ---------------- | ---------------------------------------------- |
| `health_status`  | Is the connection working?                     |
| `get_started`    | Workflow guide based on your experience level. |
| `league_presets` | See per-sport ranking weights.                 |

---

## 6. Performance Tips

- **`compact: true`** — shrinks responses ~90%. Use this by default. Retains movement signals.
- **`fields: ["game", "selection", "odds", "edge", "tier", "kai"]`** — return only what you need.
- **`skipHistory: true`** — skip odds history if you only need current prices.

Example:

> "NBA screen, compact, top 5 plays."

---

## 7. Troubleshooting

| Symptom                                   | Fix                                                     |
| ----------------------------------------- | ------------------------------------------------------- |
| `pp-query doctor` fails auth              | Re-login: `pp-query login` or re-export cookies         |
| "Connection refused" / server won't start | Run `pp-query doctor`, check path in config is absolute |
| AI says "no tools found"                  | Restart client after config change                      |
| Huge responses timeout the AI             | Use `compact: true`                                     |
| `caveman-shrink` not found                | Remove it from config, use plain `node`                 |
| ChatGPT / web ChatGPT                     | Not supported — needs a local MCP client                |

---

## 8. Environment Variables (Optional)

| Variable                     | Default                      | Description             |
| ---------------------------- | ---------------------------- | ----------------------- |
| `AUTH_FILE`                  | `~/.propprofessor/auth.json` | Auth file path          |
| `PROPPROFESSOR_MCP_NDJSON`   | (required)                   | Enable NDJSON framing   |
| `PROPPROFESSOR_CACHE_TTL_MS` | `60000`                      | Response cache TTL (ms) |
| `PROPPROFESSOR_CACHE_MAX`    | `50`                         | Max cache entries       |
| `LOCAL_TIMEZONE`             | `America/Chicago`            | CLI display timezone    |

---

## Need help?

Run `pp-query doctor` and paste the output in a GitHub issue — that covers 90% of problems.
