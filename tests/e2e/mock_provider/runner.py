from __future__ import annotations

import contextlib
import logging
import os
import socket
import subprocess
import sys
import time
from typing import Any, Generator, cast

import httpx
from pydantic import BaseModel, ConfigDict, Field

from tests.e2e.mock_provider.config import MockControlConfig

logger = logging.getLogger(__name__)


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return int(s.getsockname()[1])


class RunnerConfig(BaseModel):
    host: str = "127.0.0.1"
    port: int = Field(default_factory=find_free_port)
    http_mode: str = "auto"
    log_enabled: bool = False


def _kill_process(proc: subprocess.Popen[str]) -> None:
    try:
        proc.terminate()
        proc.wait(timeout=3.0)
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.debug(f"Termination wait error: {exc}")
    if proc.poll() is None:
        try:
            proc.kill()
            proc.wait(timeout=1.0)
        except (subprocess.TimeoutExpired, OSError) as exc:
            logger.debug(f"Kill wait error: {exc}")


def _poll_health(url: str) -> bool:
    try:
        res = httpx.get(f"{url}/health", timeout=0.5)
        return res.status_code == 200
    except (httpx.HTTPError, OSError) as exc:
        logger.debug(f"Health poll error: {exc}")
        return False


def _build_granian_cmd(
    host: str, port: int, http_mode: str, log_enabled: bool
) -> list[str]:
    cmd = [
        sys.executable,
        "-m",
        "granian",
        "--interface",
        "asgi",
        "--http",
        http_mode,
        "--host",
        host,
        "--port",
        str(port),
        "tests.e2e.mock_provider.server:app",
    ]
    if not log_enabled:
        cmd.extend(["--no-log", "--no-access-log"])
    return cmd


class MockProviderProcess(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    host: str = "127.0.0.1"
    port: int = Field(default_factory=find_free_port)
    http_mode: str = "auto"
    log_enabled: bool = False
    process: subprocess.Popen[str] | None = None

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def _build_command(self) -> list[str]:
        return _build_granian_cmd(
            self.host, self.port, self.http_mode, self.log_enabled
        )

    def start(self, wait_timeout: float = 10.0) -> MockProviderProcess:
        if self.process is not None:
            return self

        cmd = self._build_command()
        env = dict(os.environ)
        env["PYTHONPATH"] = f"{os.getcwd()}:{env.get('PYTHONPATH', '')}"

        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL if not self.log_enabled else None,
            stderr=subprocess.DEVNULL if not self.log_enabled else None,
            env=env,
            text=True,
        )

        self._wait_ready(wait_timeout)
        return self

    def _wait_ready(self, wait_timeout: float) -> None:
        deadline = time.time() + wait_timeout
        while time.time() < deadline:
            if self.process and self.process.poll() is not None:
                raise RuntimeError(
                    f"Process terminated with {self.process.returncode}"
                )
            if _poll_health(self.base_url):
                return
            time.sleep(0.05)

        self.stop()
        raise TimeoutError(f"Health check failed on {self.base_url}")

    def stop(self) -> None:
        if self.process is None:
            return
        proc = self.process
        self.process = None
        _kill_process(proc)

    def reset_state(self, keep_journal: bool = False) -> dict[str, Any]:
        res = httpx.post(
            f"{self.base_url}/mock/reset",
            params={"keep_journal": keep_journal},
            timeout=2.0,
        )
        return cast(dict[str, Any], res.json())

    def set_control(
        self, config: dict[str, Any] | MockControlConfig
    ) -> dict[str, Any]:
        payload: dict[str, Any] = (
            config.model_dump(mode="json")
            if isinstance(config, MockControlConfig)
            else config
        )
        res = httpx.post(
            f"{self.base_url}/mock/control", json=payload, timeout=2.0
        )
        return cast(dict[str, Any], res.json())

    def get_journal(self, limit: int | None = None) -> list[dict[str, Any]]:
        params = {"limit": limit} if limit is not None else {}
        res = httpx.get(
            f"{self.base_url}/mock/journal", params=params, timeout=2.0
        )
        return list(res.json().get("entries", []))

    def get_logs(self) -> list[dict[str, Any]]:
        return self.get_journal()

    def __enter__(self) -> MockProviderProcess:
        self.start()
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.stop()


MockProviderRunner = MockProviderProcess


@contextlib.contextmanager
def run_mock_provider(
    host: str = "127.0.0.1",
    port: int | None = None,
    http_mode: str = "auto",
    log_enabled: bool = False,
) -> Generator[MockProviderProcess, None, None]:
    runner = MockProviderProcess(
        host=host,
        port=port or find_free_port(),
        http_mode=http_mode,
        log_enabled=log_enabled,
    )
    with runner:
        yield runner
