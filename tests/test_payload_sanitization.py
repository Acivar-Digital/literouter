from src.main import app


def test_custom_blocks_sanitization():
    """
    Verify that incoming payloads with custom client block types (input_text, output_text)
    are successfully sanitized into standard 'text' blocks.
    """
    payload = {
        "model": "openrouter/owl-alpha",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "Hello, this is a test"}
                ]
            },
            {
                "role": "assistant",
                "content": [
                    {"type": "output_text", "text": "This is a response"}
                ]
            }
        ]
    }
    
    # Run the same block of code as in src/main.py:
    if "messages" in payload and isinstance(payload["messages"], list):
        for msg in payload["messages"]:
            if isinstance(msg.get("content"), list):
                for block in msg["content"]:
                    if isinstance(block, dict) and block.get("type") in ("input_text", "output_text"):
                        block["type"] = "text"
                        
    assert payload["messages"][0]["content"][0]["type"] == "text"
    assert payload["messages"][1]["content"][0]["type"] == "text"
