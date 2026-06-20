"""
doctor.py — CLI doctor utility for LiteRouter.

Validates config, Redis connectivity, provider API keys, and server health.
Usage: uv run python src/doctor.py
"""

import asyncio
import logging
import os
import sys
import time

import httpx

from src.config import get_config, is_gemini_provider

logging.basicConfig(level=logging.WARNING)

R = "\x1b[0m"
BOLD = "\x1b[1m"
DIM = "\x1b[2m"
GREEN = "\x1b[32m"
RED = "\x1b[31m"
YELLOW = "\x1b[33m"
CYAN = "\x1b[36m"
WHITE = "\x1b[97m"


def _print_ok(msg: str) -> None:
    print(f"  {GREEN}✓{R} {msg}")


def _print_warn(msg: str) -> None:
    print(f"  {YELLOW}⚠{R} {msg}")


def _print_err(msg: str) -> None:
    print(f"  {RED}✗{R} {msg}")


def _check_config() -> bool:
    """Check that config loads correctly."""
    print(f"\n  {BOLD}{WHITE}CONFIGURATION:{R}\n")
    config_path = os.path.join(os.getcwd(), ".env")
    if not os.path.exists(config_path):
        _print_err(f"No .env found at {config_path}")
        return False

    try:
        config = get_config()
    except Exception as exc:
        _print_err(f"Failed to load config: {exc}")
        return False

    provider_names = list(config.providers.keys())
    total_keys = sum(len(p.api_keys) for p in config.providers.values())

    _print_ok(f"Config loaded from {config_path}")
    print(f"  {DIM}Providers:{R} {', '.join(provider_names) or '(none)'}")
    print(f"  {DIM}Total keys:{R} {total_keys}")
    print(f"  {DIM}Auth key:{R} {'set' if config.auth_key else 'not set'}")

    for name, provider in config.providers.items():
        model = config.model_params.get(name, {}).get("model", "not configured")
        print(f"  {DIM}  └─ {name}:{R} {len(provider.api_keys)} keys → {model}")

    return True


async def _check_redis() -> bool:
    """Check Redis connectivity."""
    print(f"\n  {BOLD}{WHITE}REDIS:{R}\n")
    from src.redis_client import get_redis_client, get_redis_info

    client = get_redis_client()
    if client is None:
        _print_err("Redis unavailable")
        return False

    try:
        client.ping()
        info = get_redis_info()
        version = info.get("redis_version", "unknown")
        _print_ok(f"Connected (version {version})")
        return True
    except Exception as exc:
        _print_err(f"Redis ping failed: {exc}")
        return False


async def _validate_provider_keys() -> dict:
    """Validate all provider API keys by sending test requests."""
    print(f"\n  {BOLD}{WHITE}PROVIDER VALIDATION:{R}\n")
    config = get_config()

    healthy = 0
    failed = 0
    skipped = 0
    test_results = []

    async def _probe_one(provider_name, provider, key, i, model_config, use_gemini):
        nonlocal healthy, failed, skipped
        key_display = f"Key {i + 1} ({key[:8]}...)"
        print(f"    {DIM}Testing [{provider_name}] {key_display}...{R}", end="", flush=True)

        if not use_gemini and not model_config:
            skipped += 1
            test_results.append({
                "provider": provider_name, "key": key_display,
                "status": "skipped", "error": "no model configured",
            })
            print(
                f"\r    {DIM}○{R} [{provider_name}] {key_display} "
                f"{DIM}skipped (no model configured){R}",
            )
            return

        start = time.time()
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                if use_gemini:
                    test_model = "gemini-2.5-flash"
                    if model_config:
                        test_model = model_config.get("model", test_model)
                    resp = await client.post(
                        f"{provider.base_url}/models/{test_model}:generateContent",
                        json={
                            "contents": [{"role": "user", "parts": [{"text": "hello"}]}],
                            "generationConfig": {"maxOutputTokens": 1},
                        },
                        params={"key": key},
                    )
                else:
                    test_model = model_config.get("model", "gpt-3.5-turbo")
                    resp = await client.post(
                        f"{provider.base_url}/chat/completions",
                        json={
                            "model": test_model,
                            "messages": [{"role": "user", "content": "hello"}],
                            "max_tokens": 1,
                        },
                        headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {key}",
                            "User-Agent": "LiteRouter/2.2",
                        },
                    )
            latency_ms = int((time.time() - start) * 1000)

            if resp.status_code == 200:
                healthy += 1
                test_results.append({
                    "provider": provider_name, "key": key_display,
                    "status": "healthy", "latencyMs": latency_ms,
                })
                print(
                    f"\r    {GREEN}✓{R} [{provider_name}] {key_display} "
                    f"{GREEN}healthy{R} {DIM}{latency_ms}ms{R}",
                )
            elif resp.status_code in (429, 403):
                healthy += 1
                test_results.append({
                    "provider": provider_name, "key": key_display,
                    "status": "rate-limited", "latencyMs": latency_ms,
                })
                print(
                    f"\r    {YELLOW}⚡{R} [{provider_name}] {key_display} "
                    f"{YELLOW}valid (rate limited){R} {DIM}{latency_ms}ms{R}",
                )
            else:
                failed += 1
                err_text = resp.text[:100]
                test_results.append({
                    "provider": provider_name, "key": key_display,
                    "status": "error", "error": f"HTTP {resp.status_code}",
                    "latencyMs": latency_ms,
                })
                print(
                    f"\r    {RED}✗{R} [{provider_name}] {key_display} "
                    f"{RED}HTTP {resp.status_code}{R} {DIM}{latency_ms}ms{R} - {err_text}",
                )
        except Exception as exc:
            failed += 1
            latency_ms = int((time.time() - start) * 1000)
            err_msg = str(exc)
            test_results.append({
                "provider": provider_name, "key": key_display,
                "status": "error", "error": err_msg,
                "latencyMs": latency_ms,
            })
            print(
                f"\r    {RED}✗{R} [{provider_name}] {key_display} "
                f"{RED}{err_msg}{R} {DIM}{latency_ms}ms{R}",
            )

    for provider_name, provider in config.providers.items():
        if not provider.api_keys:
            _print_err(f"{provider_name}: No API keys configured")
            continue

        model_config = config.model_params.get(provider_name)
        use_gemini = is_gemini_provider(provider)

        # Probe all keys in this provider in parallel.
        await asyncio.gather(*(
            _probe_one(provider_name, provider, key, i, model_config, use_gemini)
            for i, key in enumerate(provider.api_keys)
        ))

    return {"healthy": healthy, "failed": failed, "skipped": skipped, "test_results": test_results}


async def _check_server_health() -> None:
    """Check if the LiteRouter server is running."""
    print(f"\n  {BOLD}{WHITE}SERVER STATUS:{R}\n")
    config = get_config()
    server_url = f"http://{config.host}:{config.port}"

    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{server_url}/health")
            if resp.status_code == 200:
                _print_ok(f"Server is running on {server_url}")

                provider_names = list(config.providers.keys())
                if provider_names:
                    first_provider = provider_names[0]
                    try:
                        headers = {"Content-Type": "application/json"}
                        if config.auth_key:
                            headers["Authorization"] = f"Bearer {config.auth_key}"

                        async with httpx.AsyncClient(timeout=10.0) as c2:
                            test_resp = await c2.post(
                                f"{server_url}/v1/chat/completions",
                                json={
                                    "model": first_provider,
                                    "messages": [{"role": "user", "content": "ping"}],
                                    "max_tokens": 1,
                                },
                                headers=headers,
                            )
                            if test_resp.status_code == 200:
                                _print_ok(f"Local routing via '{first_provider}' succeeded")
                            else:
                                err_text = test_resp.text[:100]
                                _print_warn(
                                    "Local routing failed: "
                                    f"HTTP {test_resp.status_code} {err_text}",
                                )
                    except Exception as exc:
                        _print_warn(f"Local routing failed: {exc}")
            else:
                _print_err(f"Server health check returned HTTP {resp.status_code}")
    except Exception:
        _print_warn(
            "Server not running. Start with: "
            f"{BOLD}uv run uvicorn src.main:app "
            f"--host 0.0.0.0 --port {config.port}{R}",
        )


async def main() -> None:
    """Run all doctor checks."""
    if "--force" in sys.argv:
        sys.argv.remove("--force")
        override = True
    else:
        override = False

    print(f"\n{CYAN}{BOLD}  LITEROUTER DOCTOR{R}\n")

    config_ok = _check_config()
    if not config_ok:
        sys.exit(1)

    await _check_redis()

    test_stats = await _validate_provider_keys()

    for result in test_stats["test_results"]:
        status = result["status"]
        if status == "healthy":
            print(
                f"  {GREEN}✓{R} {BOLD}[{result['provider']}] {result['key']}{R} "
                f"{GREEN}healthy{R} {DIM}{result['latencyMs']}ms{R}",
            )
        elif status == "rate-limited":
            print(
                f"  {YELLOW}⚡{R} {BOLD}[{result['provider']}] {result['key']}{R} "
                f"{YELLOW}valid (rate limited){R} {DIM}{result['latencyMs']}ms{R}",
            )
        elif status == "skipped":
            print(
                f"  {DIM}○{R} {BOLD}[{result['provider']}] {result['key']}{R} "
                f"{DIM}{result.get('error', 'skipped')}{R}",
            )
        else:
            latency = result.get("latencyMs", 0)
            latency_str = f"{DIM}{latency}ms{R}" if latency else ""
            error_text = result.get("error", "unknown")
            print(
                f"  {RED}✗{R} {BOLD}[{result['provider']}] {result['key']}{R} "
                f"{RED}{error_text}{R} {latency_str}",
            )

    await _check_server_health()

    total_keys = sum(len(p.api_keys) for p in get_config().providers.values())
    healthy = test_stats["healthy"]
    failed = test_stats["failed"]
    skipped = test_stats["skipped"]

    print(f"\n{CYAN}{'─' * 50}{R}")
    fail_msg = f" {RED}{failed} failed.{R}" if failed > 0 else ""
    skip_msg = f" {DIM}{skipped} skipped.{R}" if skipped > 0 else ""
    print(f"  {BOLD}{healthy}/{total_keys}{R} keys healthy.{fail_msg}{skip_msg}")
    print(f"{CYAN}{'─' * 50}{R}\n")

    if failed > 0 and not override:
        print(f"{RED}Doctor FAILED: {failed} key(s) cannot authenticate upstream.{R}")
        print(
            f"{YELLOW}Either replace the dead key(s) in .env, "
            f"or pass --force to bypass this gate.{R}"
        )
        sys.exit(2)


if __name__ == "__main__":
    asyncio.run(main())
