# PropProfessor MCP Auth Guide

This project uses a saved logged-in PropProfessor browser session to fetch short-lived access tokens.

## Recommended Location

Put your auth file here:

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

1. Log in to PropProfessor in your browser.
2. Export the browser session or storage state.
3. Save it as `~/.propprofessor/auth.json`.

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
