#!/usr/bin/env python3
"""PropProfessor hermes install script.

Subcommands:
  skill     Symlink skills/propprofessor-coach into hermes skills/external/.
  mcp       Register the propprofessor MCP server with hermes.
  cron      Register the sharp-money alert cron job.
  uninstall Reverse all of the above.
  all       Run skill + mcp (the default).
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

# Allow `python3 scripts/install.py` to import install_helpers.py from the same dir.
sys.path.insert(0, str(Path(__file__).parent))
from install_helpers import (  # noqa: E402
    resolve_hermes_home,
    resolve_active_profile,
    skill_target_path,
    run_hermes
)


REPO_ROOT = Path(__file__).resolve().parent.parent
SKILL_NAME = "propprofessor-coach"
SKILL_SOURCE = REPO_ROOT / "skills" / SKILL_NAME
MCP_NAME = "propprofessor"
MCP_SERVER_PATH = REPO_ROOT / "scripts" / "propprofessor-mcp-server.js"
AUTH_FILE_DEFAULT = Path.home() / ".propprofessor" / "auth.json"


def install_skill() -> None:
    hermes_home = resolve_hermes_home()
    profile = resolve_active_profile(hermes_home)
    target = skill_target_path(hermes_home, profile, SKILL_NAME)

    if not SKILL_SOURCE.exists():
        raise SystemExit(f"Skill source not found: {SKILL_SOURCE}")

    target.parent.mkdir(parents=True, exist_ok=True)

    if target.is_symlink() or target.exists():
        if target.is_symlink() and target.resolve() == SKILL_SOURCE.resolve():
            print(f"  skill already linked: {target}")
            return
        # Real directory or wrong symlink — back it up.
        backup = target.with_suffix(target.suffix + ".bak")
        backup.mkdir(exist_ok=False)
        for child in target.iterdir():
            child.rename(backup / child.name)
        target.rmdir()
        print(f"  backed up existing skill to {backup}")

    target.symlink_to(SKILL_SOURCE)
    print(f"  ✓ linked {SKILL_SOURCE} → {target}")

def install_mcp() -> None:
    if not MCP_SERVER_PATH.exists():
        raise SystemExit(f"MCP server not found: {MCP_SERVER_PATH}")

    # Install default config first.
    import subprocess
    setup_result = subprocess.run(
        ["node", str(REPO_ROOT / "scripts" / "query-propprofessor.js"), "setup"],
        capture_output=True, text=True
    )
    if setup_result.returncode == 0:
        print(f"  ✓ config: {setup_result.stdout.strip()}")
    else:
        print(f"  ⚠ config setup failed: {setup_result.stderr}", file=sys.stderr)

    hermes_home = resolve_hermes_home()
    auth_file = AUTH_FILE_DEFAULT
    auth_file.parent.mkdir(parents=True, exist_ok=True)
    if not auth_file.exists():
        print(f"  ⚠ auth file not found at {auth_file}. Run 'pp-query login' after install.")
    # `hermes mcp add` is idempotent — re-running updates in place.
    run_hermes([
        "mcp", "add", MCP_NAME,
        "--command", "node",
        "--args", str(MCP_SERVER_PATH),
        "--env", f"AUTH_FILE={auth_file}",
        "--env", "PROPPROFESSOR_MCP_NDJSON=true"
    ])
    print(f"  ✓ registered MCP server '{MCP_NAME}' with hermes")


def install_cron() -> None:
    """Register a no-agent sharp-money alert cron (optional)."""
    from install_helpers import hermes_bin
    import re

    prompt_path = REPO_ROOT / "docs" / "cron-prompts" / "sharp-money-alert.md"
    if not prompt_path.exists():
        raise SystemExit(f"Cron prompt template not found: {prompt_path}")

    # Extract the prompt body (between ## Prompt and ## Schedule headers).
    text = prompt_path.read_text()
    match = re.search(r"## Prompt\n(.+?)\n## Schedule", text, re.DOTALL)
    if not match:
        raise SystemExit("Could not extract prompt body from template")
    prompt_body = match.group(1).strip()

    cmd = [
        hermes_bin(), "cron", "create", "every 1h", prompt_body,
        "--name", "propprofessor-alerts",
        "--skill", "propprofessor-coach"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ⚠ cron registration failed: {result.stderr}", file=sys.stderr)
    else:
        print("  ✓ registered sharp-money alert cron (every 1h)")


def uninstall() -> None:
    hermes_home = resolve_hermes_home()
    profile = resolve_active_profile(hermes_home)
    target = skill_target_path(hermes_home, profile, SKILL_NAME)

    if target.is_symlink() or target.exists():
        target.unlink()
        print(f"  ✓ removed skill link: {target}")

    run_hermes(["mcp", "remove", MCP_NAME], check=False)
    print(f"  ✓ removed MCP server '{MCP_NAME}'")


def main() -> int:
    parser = argparse.ArgumentParser(description="Install PropProfessor into hermes.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    for name in ("skill", "mcp", "cron", "uninstall", "all"):
        sub.add_parser(name)

    args = parser.parse_args()
    handlers = {
        "skill": install_skill,
        "mcp": install_mcp,
        "cron": install_cron,
        "uninstall": uninstall,
        "all": lambda: (install_skill(), install_mcp()),
    }
    handlers[args.cmd]()
    return 0


if __name__ == "__main__":
    sys.exit(main())