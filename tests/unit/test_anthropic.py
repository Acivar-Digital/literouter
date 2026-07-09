"""
Tests for Anthropic response transformer (src/anthropic.py).

BUG CATEGORY A: Tests A1-A9 probe edge cases in the Anthropic-to-OpenAI
response format conversion. This is new code with high risk of silent failures.
"""

from src.anthropic import transform_anthropic_response


class TestAnthropicTransformer:
    """Tests for transform_anthropic_response."""

    def test_empty_content_array(self):
        """
        BUG PROBE: Empty content array.
        Anthropic may return {"content": [], ...} for empty responses.
        The code iterates over content_blocks but text_parts stays empty.
        Expected: content_text="" (empty string), not a crash.
        """
        anthropic_resp = {
            "content": [],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 0},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["message"]["content"] == ""
        assert result["choices"][0]["finish_reason"] == "stop"

    def test_only_thinking_blocks(self):
        """
        BUG PROBE: Content with only thinking blocks.
        The transformer skips thinking blocks. If ALL blocks are thinking,
        content_text will be empty. This may be correct behavior, but the
        caller might not expect empty content with a 200 OK.
        """
        anthropic_resp = {
            "content": [{"type": "thinking", "thinking": "Let me think..."}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        # Should return empty text — thinking blocks are intentionally skipped
        assert result["choices"][0]["message"]["content"] == ""
        assert result["choices"][0]["finish_reason"] == "stop"

    def test_mixed_content_blocks(self):
        """
        BUG PROBE: Mixed thinking + text blocks.
        Verifies that only text blocks are extracted and thinking blocks
        are silently discarded.
        """
        anthropic_resp = {
            "content": [
                {"type": "thinking", "thinking": "hmm"},
                {"type": "text", "text": "Hello"},
            ],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["message"]["content"] == "Hello"

    def test_unknown_stop_reason(self):
        """
        BUG PROBE: Unknown stop_reason value.
        The finish_reason_map only handles end_turn, max_tokens,
        stop_sequence, tool_use. Any other value should default to "stop".
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": "hi"}],
            "stop_reason": "some_new_reason",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["finish_reason"] == "stop"

    def test_missing_usage_field(self):
        """
        BUG PROBE: Missing usage field entirely.
        The code does `usage = anthropic_response.get("usage") or {}`
        then `usage.get("input_tokens", 0)`. If usage is None, `or {}`
        handles it. But what if usage is present but None-valued?
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": "hi"}],
            "stop_reason": "end_turn",
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["usage"]["prompt_tokens"] == 0
        assert result["usage"]["completion_tokens"] == 0
        assert result["usage"]["total_tokens"] == 0

    def test_legacy_completion_format(self):
        """
        BUG PROBE: Legacy completion format (non-messages API).
        The old Anthropic API returned {"completion": "..."} instead of
        {"content": [...]}. The code should handle this via the else branch.
        """
        anthropic_resp = {
            "completion": "Hello world",
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["message"]["content"] == "Hello world"

    def test_content_is_string_not_list(self):
        """
        BUG PROBE: Content is a string instead of a list.
        The code checks `isinstance(content_blocks, list)`. If content is
        a string, it falls through to the legacy completion path, but
        there's no "completion" key, so content_text stays "".
        This means valid text in content is silently dropped.
        """
        anthropic_resp = {
            "content": "some string",
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        # Verify the string "some string" is preserved
        assert result["choices"][0]["message"]["content"] == "some string"

    def test_none_values_in_usage(self):
        """
        Verify that None values in usage dict are safely defaulted to 0.
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": "hi"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": None, "output_tokens": None},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["usage"]["prompt_tokens"] == 0
        assert result["usage"]["completion_tokens"] == 0

    def test_output_structure_matches_openai_format(self):
        """
        BUG PROBE: Verify the complete output structure matches OpenAI format.
        Every required field must be present with the correct type.
        """
        anthropic_resp = {
            "id": "msg_abc123",
            "content": [{"type": "text", "text": "Hello!"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
            "model": "claude-sonnet-4.6",
        }
        result = transform_anthropic_response(anthropic_resp)

        # Top-level fields
        assert "id" in result
        assert "object" in result
        assert result["object"] == "chat.completion"
        assert "created" in result
        assert isinstance(result["created"], int)
        assert "model" in result
        assert "choices" in result
        assert "usage" in result

        # Choices structure
        assert isinstance(result["choices"], list)
        assert len(result["choices"]) == 1
        choice = result["choices"][0]
        assert choice["index"] == 0
        assert "message" in choice
        assert choice["message"]["role"] == "assistant"
        assert "content" in choice["message"]
        assert "finish_reason" in choice

        # Usage structure
        usage = result["usage"]
        assert "prompt_tokens" in usage
        assert "completion_tokens" in usage
        assert "total_tokens" in usage
        assert usage["prompt_tokens"] == 10
        assert usage["completion_tokens"] == 5
        assert usage["total_tokens"] == 15

    def test_multiple_text_blocks_concatenated(self):
        """
        BUG PROBE: Multiple text blocks should be concatenated.
        Anthropic may return multiple text blocks in a single response.
        """
        anthropic_resp = {
            "content": [
                {"type": "text", "text": "Part 1. "},
                {"type": "text", "text": "Part 2."},
            ],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 10},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["message"]["content"] == "Part 1. Part 2."

    def test_tool_use_stop_reason(self):
        """
        BUG PROBE: stop_reason='tool_use' should map to finish_reason='tool_calls'.
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": ""}],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["finish_reason"] == "tool_calls"

    def test_max_tokens_stop_reason(self):
        """
        BUG PROBE: stop_reason='max_tokens' should map to finish_reason='length'.
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": "truncated..."}],
            "stop_reason": "max_tokens",
            "usage": {"input_tokens": 10, "output_tokens": 100},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["finish_reason"] == "length"

    def test_content_block_missing_type_key(self):
        """
        BUG PROBE: Content block dict without 'type' key.
        The code checks `block.get("type") == "text"`. If type is None,
        it won't match "text", so the block is silently skipped.
        """
        anthropic_resp = {
            "content": [{"text": "no type key"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        # BUG: Block has text but no type key, so it's silently dropped
        assert result["choices"][0]["message"]["content"] == ""

    def test_content_block_is_not_dict(self):
        """
        BUG PROBE: Content block is not a dict (e.g., a string).
        The code does `isinstance(block, dict)` before accessing .get().
        Non-dict blocks are silently skipped.
        """
        anthropic_resp = {
            "content": ["just a string"],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["message"]["content"] == ""

    def test_usage_with_reasoning_tokens(self):
        """
        Verify that reasoning_tokens from Anthropic response are preserved.
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": "hi"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5, "reasoning_tokens": 100},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["usage"]["reasoning_tokens"] == 100

    def test_missing_stop_reason_defaults_to_stop(self):
        """
        BUG PROBE: Missing stop_reason field.
        The code uses .get("stop_reason", "stop"), so missing key defaults to "stop".
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": "hi"}],
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["finish_reason"] == "stop"

    def test_empty_content_block_text(self):
        """
        BUG PROBE: Text block with empty string text.
        Should produce empty content, not crash.
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": ""}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 0},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["message"]["content"] == ""

    def test_unicode_content(self):
        """
        BUG PROBE: Unicode content in text blocks.
        Ensures no encoding issues with non-ASCII characters.
        """
        anthropic_resp = {
            "content": [{"type": "text", "text": "你好世界 😀"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert result["choices"][0]["message"]["content"] == "你好世界 😀"

    def test_very_long_content(self):
        """
        BUG PROBE: Very long text content.
        Ensures no truncation or memory issues.
        """
        long_text = "x" * 1_000_000
        anthropic_resp = {
            "content": [{"type": "text", "text": long_text}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 500_000},
        }
        result = transform_anthropic_response(anthropic_resp)
        assert len(result["choices"][0]["message"]["content"]) == 1_000_000
