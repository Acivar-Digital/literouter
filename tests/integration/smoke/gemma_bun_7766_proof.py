import os

from openai import OpenAI

# Hit OUR Bun LiteRouter (7766) via OpenAI-compat template.
client = OpenAI(
    base_url="http://localhost:7766/v1",
    api_key=os.environ.get("LITEROUTER_AUTH_KEY", "sk-lr-8f2a9e3b1c4d7e5f"),
)

# gemma-4-31b-it via OpenAI-compat, double-nested extra_body (matches controls.py:112),
# which exercises our translateGoogleThinking + cleanGemmaPayload path on 7766.
resp = client.chat.completions.create(
    model="google/gemma-4-31b-it",
    messages=[{
        "role": "user",
        "content": "Explain quantum computing in simple terms, but without using letters e or i.",
    }],
    temperature=0.1,
    max_tokens=2000,
    extra_body={
        "google": {
            "thinking_config": {
                "thinking_level": "minimal",
                "include_thoughts": False,
            }
        }
    },
)

print("STATUS: OK")
msg = resp.choices[0].message
print("CONTENT:", repr((msg.content or "")[:400]))
print("EXTRA:", getattr(msg, "extra_content", None))
