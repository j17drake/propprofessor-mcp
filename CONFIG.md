# PropProfessor MCP Config Guide

Works with local `stdio` MCP clients. Requires `PROPPROFESSOR_MCP_NDJSON=true` for AI agent compatibility.

## Prerequisites

```bash
cd /path/to/propprofessor-mcp
npm install
npm link
pp-query install-auth --source /path/to/auth.json
pp-query doctor
```

`pp-query doctor` must pass before configuring any client.

## Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PROPPROFESSOR_MCP_NDJSON` | **Yes** | `true` — enables NDJSON framing for async tool calls |
| `AUTH_FILE` | **Yes** | Path to auth file (e.g., `/path/to/.propprofessor/auth.json`) |
| `PROPPROFESSOR_CACHE_TTL_MS` | No | Cache TTL ms (default 60000) |
| `PROPPROFESSOR_CACHE_MAX` | No | Max cache entries (default 50) |

---

## Hermes Agent (Recommended)

```yaml
# ~/.hermes/config.yaml
mcp_servers:
  propprofessor:
    args:
    - node
    - /path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js
    command: caveman-shrink
    enabled: true
    env:
      AUTH_FILE: /path/to/.propprofessor/auth.json
      PROPPROFESSOR_MCP_NDJSON: 'true'
```

**Requires**: `npm install -g caveman-shrink`

Reload: `hermes mcp reload` → `hermes mcp test propprofessor`

---

## Claude Desktop

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "caveman-shrink",
      "args": ["node", "/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/path/to/.propprofessor/auth.json"
      }
    }
  }
}
```

**Or without caveman-shrink**:
```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "node",
      "args": ["/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/path/to/.propprofessor/auth.json"
      }
    }
  }
}
```

First prompt: `Check whether the PropProfessor MCP connection is healthy.`

---

## Cursor

`.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "caveman-shrink",
      "args": ["node", "/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/path/to/.propprofessor/auth.json"
      }
    }
  }
}
```

---

## Cline

`cline_mcp_settings.json`:
```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "caveman-shrink",
      "args": ["node", "/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/path/to/.propprofessor/auth.json"
      },
      "disabled": false
    }
  }
}
```

---

## ChatGPT

**Not supported** for local stdio. This repo is designed for local MCP clients (Hermes, Claude Desktop, Cursor, Cline). ChatGPT requires remote MCP endpoints. Use a local client instead.

---

## Generic Local MCP Client

```json
{
  "mcpServers": {
    "propprofessor": {
      "command": "caveman-shrink",
      "args": ["node", "/path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js"],
      "env": {
        "PROPPROFESSOR_MCP_NDJSON": "true",
        "AUTH_FILE": "/path/to/.propprofessor/auth.json"
      }
    }
  }
}
```

---

## Auth Lookup Order

1. `AUTH_FILE` env var
2. `~/.propprofessor/auth.json`
3. `auth.json` in repo root

---

## Debug Checklist

1. `pp-query doctor` — passes?
2. Auth file at `~/.propprofessor/auth.json` or `AUTH_FILE` set?
3. `PROPPROFESSOR_MCP_NDJSON=true` in client env?
4. `caveman-shrink` on PATH if using it?
5. Client restarted after config change?
6. Direct `node` path if `pp-mcp`/`caveman-shrink` not found?