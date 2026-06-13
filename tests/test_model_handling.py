"""
Tests for model name handling in request processing (src/main.py).

BUG CATEGORY C: Tests for model name prefix stripping and edge cases.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestModelNameHandling:
    """Tests for model name prefix stripping logic."""

    def test_model_with_provider_prefix_stripped(self, monkeypatch, tmp_path):
        """
        BUG PROBE: Model "openrouter/owl-alpha" should have prefix stripped
        before sending to upstream. The upstream should receive "owl-alpha".
        """
        monkeypatch.setenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        monkeypatch.setenv("OPENROUTER_API_KEYS", "key1")
        monkeypatch.chdir(tmp_path)

        from src.config import get_config
        config = get_config()

        # Simulate the stripping logic from _process_request
        model = "openrouter/owl-alpha"
        body = {"model": model}
        if "/" in (body.get("model") or ""):
            body["model"] = body["model"].split("/", 1)[1]

        assert body["model"] == "owl-alpha"

    def test_model_without_prefix_unchanged(self):
        """
        BUG PROBE: Model "owl-alpha" (no prefix) should be sent as-is.
        """
        model = "owl-alpha"
        body = {"model": model}
        if "/" in (body.get("model") or ""):
            body["model"] = body["model"].split("/", 1)[1]

        assert body["model"] == "owl-alpha"

    def test_model_with_multiple_slashes(self):
        """
        BUG PROBE: Model "provider/sub/model" should only strip first prefix.
        split("/", 1) should produce ["provider", "sub/model"].
        """
        model = "provider/sub/model"
        body = {"model": model}
        if "/" in (body.get("model") or ""):
            body["model"] = body["model"].split("/", 1)[1]

        assert body["model"] == "sub/model"

    def test_empty_model(self):
        """
        BUG PROBE: Empty model string should not crash the split logic.
        """
        model = ""
        body = {"model": model}
        if "/" in (body.get("model") or ""):
            body["model"] = body["model"].split("/", 1)[1]

        assert body["model"] == ""

    def test_model_none(self):
        """
        BUG PROBE: None model should not crash.
        body.get("model", "") returns "" when model key is missing,
        but if model is explicitly None, the "/" in check may behave differently.
        """
        body = {"model": None}
        # This is what the code does:
        if "/" in (body.get("model") or ""):
            body["model"] = body["model"].split("/", 1)[1]
        # None doesn't contain "/", so it stays None
        assert body["model"] is None

    def test_model_with_only_slash(self):
        """
        BUG PROBE: Model that is just "/" should split to ["", ""].
        """
        body = {"model": "/"}
        if "/" in (body.get("model") or ""):
            body["model"] = body["model"].split("/", 1)[1]

        assert body["model"] == ""

    def test_model_with_trailing_slash(self):
        """
        BUG PROBE: Model "provider/" should split to ["provider", ""].
        """
        body = {"model": "provider/"}
        if "/" in (body.get("model") or ""):
            body["model"] = body["model"].split("/", 1)[1]

        assert body["model"] == ""
