# PropProfessor MCP Auth Guide

This repo uses a saved PropProfessor browser session to fetch short-lived access tokens.

## Required file

- `auth.json`, saved in the repo root

The file is ignored by git. Copy it from your existing PropProfessor setup or save a fresh session after logging in.

## How the token flow works

1. The client reads PropProfessor cookies from `auth.json`
2. It sends those cookies to PropProfessor's access-token endpoint
3. It uses the returned bearer token for `/screen`, `/fantasy`, and related requests

## If you need a fresh session

Use your normal browser login flow for PropProfessor, then save the browser storage state into this repo as `auth.json`.

## Troubleshooting

- If you see `No PropProfessor cookies found in auth.json`, the session file is missing or stale
- If requests start failing with auth errors, refresh `auth.json` from a logged-in browser session
- If you are testing locally, keep `auth.json` next to `package.json`
