# PropProfessor MCP Config Guide

This project works best with local MCP clients that support `stdio` servers directly.

Before configuring any client, run:

```bash
cd /path/to/propprofessor-mcp
npm install
npm link
pp-query install-auth --source /path/to/auth.json
pp-query doctor
```

If `pp-query doctor` passes, continue with your client below.

## Claude Desktop

Claude Desktop has strong support for local MCP servers.

Use this config shape in Claude Desktop:

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

If `pp-mcp` is not available on your PATH, use:

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

First prompt to try:

`Check whether the PropProfessor MCP connection is healthy.`

If tools do not appear:

- restart Claude Desktop
- rerun `pp-query doctor`
- switch to the direct `node` path if `pp-mcp` is not being found

## Cursor

Cursor supports local `stdio` MCP servers through `mcp.json`.

Project config example:

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

Direct path fallback:

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

First prompt to try:

`Check whether the PropProfessor MCP connection is healthy.`

If it does not work:

- verify the correct `mcp.json` location
- rerun `pp-query doctor`
- use the direct `node` path if `pp-mcp` is not available

## Cline

Cline supports local MCP servers through `cline_mcp_settings.json`.

Example:

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "pp-mcp",
      "args": [],
      "env": {
        "PROPPROFESSOR_ODDS_HISTORY_LOOKBACK_HOURS": "6"
      },
      "disabled": false
    }
  }
}
```

Direct path fallback:

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
      },
      "disabled": false
    }
  }
}
```

First prompt to try:

`Check whether the PropProfessor MCP connection is healthy.`

If it does not work:

- verify the MCP settings file is the one Cline is actually using
- rerun `pp-query doctor`
- use the direct `node` path if needed

## ChatGPT

ChatGPT supports MCP differently from local `stdio` MCP clients.

This repo is currently designed for local MCP clients that can launch `pp-mcp` directly. ChatGPT's MCP support is oriented around remote MCP servers and ChatGPT app-style integrations, not launching this local server process directly inside ChatGPT.

What this means:

- there is no recommended local `pp-mcp` ChatGPT setup for this repo today
- if ChatGPT support matters, the recommended future direction is exposing this server as a remote MCP endpoint

Practical recommendation:

- use Claude Desktop, Cursor, or Cline today if you want the fastest path
- treat ChatGPT support as a future remote-deployment step, not a local setup step

What a future ChatGPT-friendly path would look like:

1. run this MCP server behind a remote transport that ChatGPT can reach
2. secure it appropriately because it would no longer be local-only
3. connect ChatGPT to that remote MCP endpoint instead of trying to launch `pp-mcp` locally

If you mainly use ChatGPT today, this repo will be easier to use through Claude Desktop, Cursor, or Cline until a remote MCP path is added.

## Generic Local MCP

If your client supports local `stdio` MCP servers, start with this:

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

Direct path fallback:

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

First prompt to try:

`Check whether the PropProfessor MCP connection is healthy.`

## Shared Notes

Auth lookup order:

1. `AUTH_FILE`
2. `~/.propprofessor/auth.json`
3. `auth.json` in the repo root

Useful commands:

```bash
pp-query doctor
pp-query health
pp-query screen --league NBA --market Moneyline
pp-query tennis --market Moneyline --limit 10
```

If something fails:

1. Run `pp-query doctor`
2. Make sure your auth file exists at `~/.propprofessor/auth.json` or set `AUTH_FILE`
3. If your client cannot find `pp-mcp`, use the direct `node` path setup
