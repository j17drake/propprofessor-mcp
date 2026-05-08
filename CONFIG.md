# PropProfessor MCP Config Guide

This project works with any MCP client that can launch a local stdio server.

## Recommended Setup

Install and link the package first:

```bash
cd /path/to/propprofessor-mcp
npm install
npm link
pp-query doctor
```

If `pp-query doctor` passes, use `pp-mcp` as your MCP command.

## Generic MCP Config

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "pp-mcp",
      "args": [],
      "env": {
        "PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS": "6"
      }
    }
  }
}
```

## Direct Path Setup

If your MCP client does not use linked binaries well, point it directly at the server script:

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": [
        "/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"
      ],
      "env": {
        "PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS": "6"
      }
    }
  }
}
```

## Client Notes

Use the same command settings in any MCP client.

Typical examples include:

- Claude Desktop
- Hermes
- Cursor-compatible MCP clients
- other local stdio MCP launchers

The important part is just that the client launches `pp-mcp` or the direct Node script.

## Optional Environment Variables

- `AUTH_FILE`, override the auth file path
- `LOCAL_TIMEZONE`, local CLI display timezone, default `America/Chicago`
- `PROPPROFESSOR_MCP_NDJSON`, set to `true` for NDJSON framing
- `PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS`, ranked odds-history lookback window in hours, default `6`

## Useful Commands

```bash
pp-query doctor
pp-query health
pp-query screen --league NBA --market Moneyline
pp-query tennis --market Moneyline --limit 10
```

## If Something Fails

1. Run `pp-query doctor`
2. Make sure your auth file exists at `~/.propprofessor/auth.json` or set `AUTH_FILE`
3. If your client cannot find `pp-mcp`, use the direct `node` path setup above
