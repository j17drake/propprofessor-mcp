# PropProfessor MCP Auth Guide

This project uses a saved logged-in PropProfessor browser session to fetch short-lived access tokens.

You need a paid PropProfessor account at propprofessor.com before this auth flow will be useful.

## Recommended Location

Easiest option:

```bash
pp-query install-auth --source /path/to/auth.json
```

That installs your saved browser session into:

```bash
~/.propprofessor/auth.json
```

That is the default user-level location.

## Auth Lookup Order

The project checks auth in this order:

1. `AUTH_FILE`
2. `~/.propprofessor/auth.json`
3. `auth.json` in the repo root

For most users, the best choice is `~/.propprofessor/auth.json`.

## What Should Be In `auth.json`

It should be a saved browser session from a logged-in PropProfessor session.

The important part is that it includes PropProfessor cookies.

## How The Auth Flow Works

1. The client reads PropProfessor cookies from your saved session file.
2. It sends those cookies to PropProfessor's access-token endpoint.
3. It uses the returned bearer token for live requests.

## If You Need A Fresh Session

1. Log in to your paid PropProfessor account in your browser.
2. Export the browser session or storage state.
3. Run `pp-query install-auth --source /path/to/exported-auth.json`.

## How To Export `auth.json`

Any method is fine as long as it produces a JSON file that contains your logged-in PropProfessor browser cookies.

Common options:

1. Browser automation tools that can save storage state
2. A browser extension that can export cookies or full session state as JSON
3. Your existing personal PropProfessor automation or scraping setup, if you already have one

What to look for in the exported file:

- it should be JSON
- it should contain a `cookies` array
- it should include cookies for `propprofessor.com` or its subdomains

After exporting, install it with:

```bash
pp-query install-auth --source /path/to/exported-auth.json
```

Then verify it with:

```bash
pp-query doctor
```

If `doctor` says `No PropProfessor cookies found`, the export did not include the right cookies and you should export again from a logged-in browser session.

## Easiest Way To Check Your Setup

Run:

```bash
pp-query doctor
```

That will tell you:

- whether an auth file was found
- which path was selected
- whether the file appears usable
- whether PropProfessor responds

## Troubleshooting

If you see `No PropProfessor cookies found`:

- the file exists, but it does not contain PropProfessor cookies
- export a fresh logged-in browser session

If auth was found but live requests fail:

- the session may be stale
- log in again and export a fresh file

If you want to keep auth somewhere else:

```bash
AUTH_FILE=/path/to/auth.json pp-query doctor
```
