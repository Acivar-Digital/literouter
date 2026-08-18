from __future__ import annotations

import asyncio
import json
import logging
import socket
from typing import Any, AsyncIterator, Dict, List, Set

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger("mock_upstream")


class MockCallRecord(BaseModel):
    key: str = ""
    path: str = ""
    is_stream: bool = False
    timestamp: float = 0.0


class MockServerState(BaseModel):
    calls: List[MockCallRecord] = Field(default_factory=list)
    keys_seen: Dict[str, int] = Field(default_factory=dict)
    keys_to_fail_429_once: Set[str] = Field(default_factory=set)
    fail_first_n_requests: int = 0
    fail_all_429: bool = False


class MockUpstreamContext:
    def __init__(self) -> None:
        self.state = MockServerState()

    def reset(self) -> None:
        self.state = MockServerState()

    def record_call(self, key: str, path: str, is_stream: bool) -> None:
        loop_time = asyncio.get_event_loop().time()
        record = MockCallRecord(key=key, path=path, is_stream=is_stream, timestamp=loop_time)
        self.state.calls.append(record)
        self.state.keys_seen[key] = self.state.keys_seen.get(key, 0) + 1

    def should_fail_429(self, key: str) -> bool:
        if self.state.fail_all_429:
            return True
        if self.state.fail_first_n_requests > 0:
            self.state.fail_first_n_requests -= 1
            return True
        if key in self.state.keys_to_fail_429_once and self.state.keys_seen.get(key, 0) <= 1:
            return True
        return False


def get_ephemeral_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def make_429_payload() -> Dict[str, Any]:
    return {
        "error": {
            "message": "Mock upstream: Rate limit exceeded (429)",
            "type": "rate_limit_error",
            "code": 429,
        }
    }


def make_chat_payload(content: str = "Mock response success") -> Dict[str, Any]:
    return {
        "id": "chatcmpl-mock-e2e-1",
        "object": "chat.completion",
        "created": 1723380000,
        "model": "mock-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
    }


async def sse_event_generator() -> AsyncIterator[bytes]:
    chunks = [
        {"choices": [{"index": 0, "delta": {"content": "Hello "}, "finish_reason": None}]},
        {"choices": [{"index": 0, "delta": {"content": "from mock "}, "finish_reason": None}]},
        {"choices": [{"index": 0, "delta": {"content": "stream!"}, "finish_reason": None}]},
        {
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 6, "total_tokens": 16},
        },
    ]
    for chunk in chunks:
        yield f"data: {json.dumps(chunk)}\n\n".encode("utf-8")
        await asyncio.sleep(0.05)
    yield b"data: [DONE]\n\n"


def create_mock_upstream_app(ctx: MockUpstreamContext) -> FastAPI:
    app = FastAPI(title="LiteRouter Mock Upstream")

    @app.get("/health")
    def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.post("/mock/reset")
    def reset_state() -> Dict[str, str]:
        ctx.reset()
        return {"status": "reset"}

    @app.post("/chat/completions")
    @app.post("/api/v1/chat/completions")
    async def chat_completions(request: Request) -> Response:
        auth_header = request.headers.get("Authorization", "")
        key = auth_header.replace("Bearer ", "").strip()
        body = await request.json()
        is_stream = bool(body.get("stream", False))

        ctx.record_call(key=key, path="/chat/completions", is_stream=is_stream)

        if ctx.should_fail_429(key):
            return JSONResponse(status_code=429, content=make_429_payload())

        if is_stream:
            return StreamingResponse(
                sse_event_generator(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )

        return JSONResponse(status_code=200, content=make_chat_payload())

    return app
