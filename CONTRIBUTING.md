# Contributing to PropProfessor MCP

Thanks for your interest. This document covers how to set up locally, add tools, and ship changes.

## Development Setup

```bash
git clone https://github.com/j17drake/propprofessor-mcp.git
cd propprofessor-mcp
npm install
```

`pp-mcp` and `pp-query` are available as local scripts via `node scripts/propprofessor-mcp-server.js` and `node scripts/query-propprofessor.js`.

## Running Tests

```bash
npm test                         # full suite (489 tests)
npm run smoke:live               # live API smoke (requires auth.json)
npm run smoke:player-context     # player context smoke (requires Nitter or X session)
```

Tests use Node's built-in `node:test` runner. No external test framework.

## Project Structure

```
lib/                          # Shared modules (imported by server + CLI)
  propprofessor-api.js        # HTTP client for PropProfessor endpoints
  propprofessor-tool-definitions.js  # MCP tool schemas + descriptions
  propprofessor-mcp-ranked-screen.js # Ranking pipeline + compact mode
  propprofessor-sharp-plays.js       # Sharp play classification
  propprofessor-risk-score.js        # Risk scoring + tier assignment
  propprofessor-player-context.js    # News/tweets/risk flag
  ...

scripts/
  propprofessor-mcp-server.js  # MCP server entrypoint (stdio transport)
  query-propprofessor.js       # CLI for setup/debugging
  export-ranked-screen.js      # Export screen data to JSON
  smoke-live.js                # Live API smoke test
  smoke-player-context.js      # Player context smoke test

test/                          # Test files (mirrors lib/ structure)
```

## Adding a New MCP Tool

1. **Define the tool** in `lib/propprofessor-tool-definitions.js`:
   - Add to `buildToolDefinitions()` with name, description, inputSchema
   - Follow existing patterns for param types (`string`, `boolean`, `array`, `number`)

2. **Add the handler** in `scripts/propprofessor-mcp-server.js`:
   - Add async handler function in the `handlers` object
   - Validate required params, return `{ ok: true, result: ... }` or `{ ok: false, error: '...' }`
   - Thread through `compact`, `fields`, `include`, `skipHistory` if it calls screen ranking

3. **Add tests** in `test/`:
   - Create `test/propprofessor-<tool-name>.test.js`
   - Test: happy path, missing params, empty results, error handling
   - Mock HTTP calls; don't hit live APIs in unit tests

4. **Update docs**:
   - Add to tool table in `README.md`
   - Add changelog entry in `CHANGELOG.md` "Unreleased"

## Code Style

- CommonJS (`require`/`module.exports`) — not ESM
- `'use strict'` at top of every file
- Run `npm run lint` and `npm run format:check` before committing
- Prettier config: `.prettierrc.json` (single quotes, trailing commas, 100 char width)

## Release Process

1. Update version in `package.json`
2. Move "Unreleased" section in `CHANGELOG.md` to new version heading
3. Run `npm test` — all 489 must pass
4. Run `npm run check:version` — version must match across package.json and changelog
5. Commit, then tag: `git tag v1.0.X && git push origin v1.0.X`
6. GitHub Actions auto-creates the release

## Reporting Bugs

Open an issue with:

- Tool name + params used
- Expected vs actual output
- Node version (`node --version`)
- Whether it reproduces with `pp-query` CLI or only via MCP client

## Questions?

Open a discussion or issue. PRs welcome.
