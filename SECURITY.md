# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |

## Reporting a Vulnerability

If you discover a security issue, please report it by opening a GitHub issue with the `security` label. Do not disclose publicly until it's resolved.

**What to include:**

- Description of the vulnerability
- Steps to reproduce
- Affected version
- Suggested fix (if any)

## Scope

In scope:

- Authentication bypass or credential exposure in the MCP server
- Injection attacks via tool parameters
- Data leakage between MCP clients sharing the same server process

Out of scope:

- Vulnerabilities in the PropProfessor API itself (report to PropProfessor directly)
- Issues in third-party MCP clients (Claude Desktop, Cursor, etc.)
- User error (e.g., committing `auth.json` to a public repo)

## Response

- Acknowledgment within 48 hours
- Fix or mitigation within 7 days for critical issues
- Disclosure coordinated with the reporter
