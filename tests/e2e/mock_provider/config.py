from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class KeyModeConfig(BaseModel):
    key: str
    mode: str = "normal"  # normal, rate_limit, server_error:500, etc.


class MockControlConfig(BaseModel):
    """Configuration settings for Mock Provider behavior."""

    latency_ms: int = Field(
        default=0,
        description="Artificial delay in ms before responding or first token",
    )
    status_code: int = Field(
        default=200,
        description="HTTP status code to return (e.g. 200, 429, 500, 502, 503, 529)",
    )
    ghost: bool = Field(
        default=False,
        description="Accept TCP connection but drop or never send first token",
    )
    ghost_mode: Literal["hang", "drop"] = Field(
        default="hang",
        description="Ghost behavior: 'hang' (infinite delay) or 'drop' (empty/broken response)",
    )
    rate_limit_reset_sec: Optional[int] = Field(
        default=None,
        description="Value for Retry-After and x-ratelimit-reset headers",
    )
    stream: Optional[bool] = Field(
        default=None,
        description="Force stream behavior if set; otherwise inferred from request body",
    )
    stream_chunks_count: int = Field(
        default=7,
        description="Number of chunks in mock SSE stream",
    )
    stream_chunk_delay_ms: int = Field(
        default=10,
        description="Delay in ms between SSE stream chunks",
    )
    custom_headers: Dict[str, str] = Field(
        default_factory=dict,
        description="Custom headers to include in the HTTP response",
    )
    response_body: Optional[Any] = Field(
        default=None,
        description="Custom response body to return instead of default templates",
    )
    # Advanced control modes & sequence support
    key_modes: Dict[str, str] = Field(
        default_factory=dict,
        description="Per-key behavior mapping (e.g. {'sk-fail': 'rate_limit'})",
    )
    sequence: List[str] = Field(
        default_factory=list,
        description="Sequence of modes to cycle through across requests",
    )


class JournalEntry(BaseModel):
    """Record of a received incoming request in the mock server."""

    id: str
    timestamp: float
    iso_time: str
    arrival_delta_ms: float
    method: str
    path: str
    query_params: Dict[str, str]
    headers: Dict[str, str]
    body: Optional[Any] = None
    client_host: Optional[str] = None
    provider_key: Optional[str] = None
