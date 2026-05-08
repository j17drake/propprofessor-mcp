# Maintainer Notes

This file is for release and maintenance workflow details that should not clutter the beginner setup flow in `README.md`.

## Manual Live Smoke Workflow

This repo includes a manual GitHub Actions workflow for a live smoke check.

Before running it, add this repository secret:

- `PROPPROFESSOR_AUTH_JSON`, the full contents of a working `auth.json`

Then run the `manual-live-smoke` workflow from the Actions tab. It installs dependencies, writes `auth.json` from the secret, and runs:

```bash
npm run smoke:live
```

## Release Checklist

Before creating a new GitHub release:

1. Update the version in `package.json`
2. Add the matching heading in `CHANGELOG.md`
3. Run `npm test`
4. Run `npm run check:version`
5. Run `npm run smoke:live`
6. Create and push the git tag
7. Publish the GitHub release from that tag

## Packaging Notes

- `main` points at the MCP server entrypoint
- `pp-mcp` and `pp-query` are exposed as binaries
- `npm test` runs the `node:test` suite
- `npm run smoke:live` performs a live authenticated ranked `/screen` smoke check before tagging a release
