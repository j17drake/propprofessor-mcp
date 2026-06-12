"""End-to-end test for install.py. Uses a temporary HERMES_HOME to avoid
touching the user's real config."""
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
INSTALL = REPO_ROOT / "scripts" / "install.py"


@pytest.fixture
def fake_hermes_home(tmp_path, monkeypatch):
    """Create a minimal hermes home with config.yaml and bin/hermes stub."""
    home = tmp_path / "fake_hermes"
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text("agent:\n  active_profile: default\n")
    (home / "skills" / "external").mkdir(parents=True)
    bin_dir = home / "bin"
    bin_dir.mkdir()
    hermes_stub = bin_dir / "hermes"
    hermes_stub.write_text("#!/bin/sh\necho \"fake hermes $*\"\nexit 0\n")
    hermes_stub.chmod(0o755)
    monkeypatch.setenv("HERMES_HOME", str(home))
    # Prepend fake hermes to PATH so install_helpers.hermes_bin() finds it first.
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ.get('PATH', '')}")
    return home


def test_install_skill_creates_symlink(fake_hermes_home):
    result = subprocess.run(
        [sys.executable, str(INSTALL), "skill"],
        capture_output=True, text=True,
        env={**os.environ, "HERMES_HOME": str(fake_hermes_home), "PATH": f"{fake_hermes_home / 'bin'}:{os.environ.get('PATH', '')}"}
    )
    assert result.returncode == 0, result.stderr
    target = fake_hermes_home / "skills" / "propprofessor-coach"
    assert target.is_symlink()
    assert target.resolve() == (REPO_ROOT / "skills" / "propprofessor-coach").resolve()


def test_install_skill_idempotent(fake_hermes_home):
    """Running twice doesn't error and doesn't create a nested symlink."""
    subprocess.run(
        [sys.executable, str(INSTALL), "skill"],
        capture_output=True, text=True,
        env={**os.environ, "HERMES_HOME": str(fake_hermes_home), "PATH": f"{fake_hermes_home / 'bin'}:{os.environ.get('PATH', '')}"},
        check=True
    )
    result = subprocess.run(
        [sys.executable, str(INSTALL), "skill"],
        capture_output=True, text=True,
        env={**os.environ, "HERMES_HOME": str(fake_hermes_home), "PATH": f"{fake_hermes_home / 'bin'}:{os.environ.get('PATH', '')}"}
    )
    assert result.returncode == 0, result.stderr
    target = fake_hermes_home / "skills" / "propprofessor-coach"
    assert target.is_symlink()
    # Resolve once — should still be the source, not a nested link.
    assert target.resolve() == (REPO_ROOT / "skills" / "propprofessor-coach").resolve()


def test_install_mcp_calls_hermes(fake_hermes_home, capsys):
    """Test that install_mcp runs without error and produces expected output."""
    # Create a fake hermes at the expected venv location to intercept the call.
    venv_hermes = fake_hermes_home / "hermes-agent" / "venv" / "bin" / "hermes"
    venv_hermes.parent.mkdir(parents=True, exist_ok=True)
    venv_hermes.write_text("#!/bin/sh\necho \"fake hermes $*\"\nexit 0\n")
    venv_hermes.chmod(0o755)
    
    result = subprocess.run(
        [sys.executable, str(INSTALL), "mcp"],
        capture_output=True, text=True,
        env={**os.environ, "HERMES_HOME": str(fake_hermes_home)}
    )
    assert result.returncode == 0, result.stderr
    captured = capsys.readouterr()
    # The fake hermes stub echoes its args; verify it was called with mcp add propprofessor.
    assert "fake hermes mcp add propprofessor" in (result.stdout + result.stderr + captured.out)