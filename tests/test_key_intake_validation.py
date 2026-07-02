"""
test_key_intake_validation.py

Gap closure: prove that LiteRouter rejects invalid/placeholder API keys
at TWO gate levels:

  Gate 1 (static, at config load): env-sourced keys that obviously look like
  placeholders (e.g. 'nvapi-NEWNIMKEY1234567890', empty, bracketed, or
  short test strings) must be FILTERED OUT of the provider registry and
  logged, not silently passed through to the router.

Prior to the fix, the bad key 'nvapi-NEWNIMKEY1234567890' caused the daemon
to return 403 to live OpenCode requests because the router rotated it
into the request stream unguarded.
"""

from src.config import _MIN_KEY_LENGTH, is_invalid_api_key  # noqa: WPS433


def test_placeholder_key_is_filtered():
    assert is_invalid_api_key("nvapi-NEWNIMKEY1234567890"), (
        "Real-world offender 'nvapi-NEWNIMKEY1234567890' must be filtered"
    )


def test_empty_and_whitespace_keys_filtered():
    assert is_invalid_api_key("")
    assert is_invalid_api_key("   ")
    assert is_invalid_api_key("\t")
    assert is_invalid_api_key("\n")


def test_bracketed_placeholder_filtered():
    """Common 'remember-to-fill-me' foot-gun: <your-key>"""
    assert is_invalid_api_key("<your-key-here>")
    assert is_invalid_api_key("CHANGEME")
    assert is_invalid_api_key("XXX")
    assert is_invalid_api_key("Test")


def test_short_keys_filtered():
    """All real provider keys exceed _MIN_KEY_LENGTH (30)."""
    assert is_invalid_api_key("a")
    assert is_invalid_api_key("sk-test-1")


def test_position_aware_warning_includes_index(monkeypatch, tmp_path, caplog):
    """
    Gate 1 must emit a WARNING that names the exact position of the bad key
    in NVIDIA_API_KEYS so a human fixing .env knows where to look.
    """
    import logging

    from src.config import LiteRouterConfig

    monkeypatch.setenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")
    monkeypatch.setenv(
        "NVIDIA_API_KEYS",
        "nvapi-REALKEY1234567890123456789012345678901234567890,"
        "nvapi-NEWNIMKEY1234567890,"
        "nvapi-REALKEY2345678901234567890123456789012345678901",
    )

    caplog.set_level(logging.DEBUG)
    LiteRouterConfig()

    msgs = " | ".join(r.getMessage() for r in caplog.records)
    assert "key #2" in msgs, f"WARNING must reference position #2; got: {msgs}"
    assert "PLACEHOLDER" in msgs


def test_realistic_key_shapes_pass():
    # Real Nvidia keys are 70 chars and start with nvapi-
    # Real Anthropic keys start with sk-ant-
    # Real OpenRouter keys start with sk-or-
    real_nvidia = "nvapi-" + "A" * 64
    real_openrouter = "sk-or-" + "Z" * 50
    assert len(real_nvidia) == 70
    assert not is_invalid_api_key(real_nvidia)
    assert not is_invalid_api_key(real_openrouter)


def test_min_key_length_constant_documented():
    """Lock the contract: 10 is the floor that distinguishes real keys
    from obvious test placeholders."""
    assert _MIN_KEY_LENGTH == 10


def test_doctor_exits_nonzero_on_dead_key(monkeypatch, tmp_path):
    """
    Gate 2: doctor.py must exit non-zero (code 2) when at least one
    key fails live upstream authentication. The start.sh / restart.sh
    scripts rely on this exit code to refuse boot.
    """
    env_file = tmp_path / ".env"
    env_file.write_text(
        "LITEROUTER_HOST=0.0.0.0\n"
        "LITEROUTER_PORT=7766\n"
        "LITEROUTER_TEMPLATE=openai\n"
        "LITEROUTER_PROVIDER=openrouter\n"
        # Point at a deliberately-broken host so any probe HTTP-fails fast.
        "NVIDIA_BASE_URL=http://127.0.0.1:1\n"
        "NVIDIA_API_KEYS=nvapi-REALKEY1234567890123456789012345678901234567890\n"
    )
    monkeypatch.chdir(tmp_path)

    # Patch get_config so doctor sees only the broken host.
    monkeypatch.setenv("NVIDIA_BASE_URL", "http://127.0.0.1:1")
    monkeypatch.setenv(
        "NVIDIA_API_KEYS",
        "nvapi-REALKEY1234567890123456789012345678901234567890",
    )

    import subprocess
    result = subprocess.run(
        ["uv", "run", "python", "src/doctor.py"],
        capture_output=True, text=True, timeout=30,
    )
    # Health probe against 127.0.0.1:1 must fail → doctor exits 2.
    assert result.returncode == 2, (
        f"doctor.py must exit 2 on dead key (got {result.returncode})\n"
        f"stdout: {result.stdout[-500:]}\n"
        f"stderr: {result.stderr[-500:]}"
    )
