from openai import OpenAI

client = OpenAI(
    api_key="localfreegemini",
    base_url="http://10.32.34.243:18000/v1/openai",
)

response = client.chat.completions.create(
    model="gemma-4-31b-it",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Explain to me how AI works in one sentence."},
    ],
    extra_body={
        "extra_body": {
            "google": {
                "thinking_config": {
                    "thinking_level": "minimal",
                    "include_thoughts": False,
                }
            }
        }
    },
)

print(response.choices[0].message)
