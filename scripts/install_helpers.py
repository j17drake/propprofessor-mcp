# scripts/install_helpers.py
"""Shared helpers for hermes install flows. No external deps — stdlib only."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

def resolve_hermes_home() -> Path:
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.home() / ".hermes").resolve()

def resolve_active_profile(hermes_home: str | Path) -> str:
    """Read the active profile from config.yaml. Falls back to 'default'.

    Note: hermes currently loads skills from <HERMES_HOME>/skills/ regardless
    of profile (see hermes_constants.get_skills_dir). Profile-aware skill dirs
    are a planned future — this helper reads the configured profile for
    completeness but install_skill does NOT currently use it for pathing.
    Track: https://github.com/NousResearch/hermes-agent — search 'external_dirs'
    and 'profile' to confirm the contract before wiring profile-aware paths.
    """
    config_path = Path(hermes_home) / "config.yaml"
    if not config_path.exists():
        return "default"
    text = config_path.read_text()
    # Simple regex — avoids requiring PyYAML in the installer.
    match = re.search(r"active_profile:\s*['\"]?([A-Za-z0-9_-]+)", text)
    return match.group(1) if match else "default"

def skill_target_path(hermes_home: str | Path, profile: str, skill_name: str) -> Path:
    """Return the target path for a skill in the hermes installation.

    PATCHED: Skills go to <HERMES_HOME>/skills/<name>/ (NOT
    <HERMES_HOME>/profiles/<profile>/skills/external/...).

    The profile arg is kept for signature stability but unused; hermes has a
    single global skills directory.
    """
    del profile  # intentionally unused — see docstring above
    return Path(hermes_home) / "skills" / skill_name

def hermes_bin() -> str:
    """Locate the hermes binary. The venv at ~/.hermes/hermes-agent/venv/bin/hermes
    is the real binary; ~/.local/bin/hermes is a thin wrapper that's not always on
    PATH for cron / sub-spawned shells. Prefer the venv path.
    """
    candidates = [
        Path.home() / ".hermes" / "hermes-agent" / "venv" / "bin" / "hermes",
        Path("/opt/homebrew/bin/hermes"),
        Path("/usr/local/bin/hermes"),
    ]
    for c in candidates:
        if c.exists() and os.access(c, os.X_OK):
            return str(c)
    return "hermes"  # last resort — hope it's on PATH

def run_hermes(args: list[str], check: bool = True) -> int:
    import subprocess
    cmd = [hermes_bin(), *args]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        print(result.stdout, file=sys.stdout)
        print(result.stderr, file=sys.stderr)
        raise SystemExit(f"hermes {' '.join(args)} failed (exit {result.returncode})")
    return result.returncode

if __name__ == "__main__":
    # CLI: python3 scripts/install_helpers.py skill-path <profile> <name>
    if len(sys.argv) >= 4 and sys.argv[1] == "skill-path":
        print(skill_target_path(resolve_hermes_home(), sys.argv[2], sys.argv[3]))