# PropProfessor MCP Config Guide

## Local npm link setup

```bash
cd /path/to/propprofessor-mcp
npm install
npm link
```

After that, these commands are available on your PATH:

- `pp-mcp`
- `pp-query`

## Claude or Hermes MCP config

Use the `pp-mcp` binary as the MCP server command:

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

## Direct repo-path setup

If your launcher wants an explicit path instead of a linked binary, point it at:

```bash
node /path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js
```

Useful environment variables:

- `AUTH_FILE`, path to the saved PropProfessor session JSON
- `LOCAL_TIMEZONE`, local display timezone for CLI output, default `America/Chicago`
- `PROPPROFESSOR_MCP_NDJSON`, set to `true` for NDJSON framing
- `PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS`, ranked odds-history lookback window in hours, default `6`
- ranked MCP tools also accept `debug`, and local CLI helpers accept `--debug` or `--no-debug` to include or suppress verbose movement-debug payloads

## Useful CLI examples

```bash
pp-query health
pp-query screen --league NBA --market Moneyline
pp-query screen --league NBA --market Moneyline --lookback-hours 4
pp-query tennis --market Moneyline --limit 10 --lookbackHours 8
npm run smoke:live
```
