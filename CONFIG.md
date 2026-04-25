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
      "args": []
    }
  }
}
```

## Direct repo-path setup

If your launcher wants an explicit path instead of a linked binary, point it at:

```bash
node /path/to/propprofessor-mcp/scripts/propprofessor-mcp-server.js
```

## Useful CLI examples

```bash
pp-query health
pp-query screen --league NBA --market Moneyline
pp-query tennis --market Moneyline --limit 10
```
