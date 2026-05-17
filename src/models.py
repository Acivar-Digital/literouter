"""
models.py — Pydantic data models for LiteRouter request/response payloads.

Defines OpenAI-compatible chat completion request and response schemas using
Pydantic v2.
"""

import time
import uuid

from pydantic import BaseModel, ConfigDict


class ChatMessage(BaseModel):
    """A single message in a chat conversation."""

    role: str  # "user", "assistant", "system"
    content: str


class ChatCompletionRequest(BaseModel):
    """OpenAI-compatible chat completion request body."""

    model: str  # provider name or "provider/alias"
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None

    model_config = ConfigDict(extra="allow")


class Choice(BaseModel):
    """A single completion choice in the response."""

    index: int
    message: ChatMessage
    finish_reason: str


class Usage(BaseModel):
    """Token usage statistics."""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    """OpenAI-compatible chat completion response body."""

    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[Choice]
    usage: Usage | None = None

    @classmethod
    def create(
        cls,
        model: str,
        content: str,
        finish_reason: str = "stop",
        usage: Usage | None = None,
    ) -> "ChatCompletionResponse":
        """Convenience factory for building a simple single-choice response."""
        return cls(
            id=f"chatcmpl-{uuid.uuid4().hex[:12]}",
            created=int(time.time()),
            model=model,
            choices=[
                Choice(
                    index=0,
                    message=ChatMessage(role="assistant", content=content),
                    finish_reason=finish_reason,
                )
            ],
            usage=usage,
        )
