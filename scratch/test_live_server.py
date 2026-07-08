import httpx

def test_port(port, label):
    url = f"http://localhost:{port}/v1/chat/completions"
    headers = {
        "Authorization": "Bearer sk-lr-8f2a9e3b1c4d7e5f",
        "Content-Type": "application/json"
    }

    print(f"\n==========================================")
    print(f" TESTING {label} on Port {port}")
    print(f"==========================================")

    # 1. Test Zen model
    payload_zen = {
        "model": "zen/deepseek-v4-flash-free",
        "messages": [{"role": "user", "content": "Hello"}],
        "max_tokens": 10
    }
    
    print("Testing Zen Deepseek v4 Flash...")
    try:
        resp_zen = httpx.post(url, headers=headers, json=payload_zen, timeout=30.0)
        print(f"Zen Response Status: {resp_zen.status_code}")
        print(f"Zen Response body: {resp_zen.text[:200]}")
    except Exception as e:
        print(f"Zen request failed: {e}")

    # 2. Test Nvidia model
    payload_nvidia = {
        "model": "nvidia/deepseek-ai/deepseek-v4-flash",
        "messages": [{"role": "user", "content": "Hello"}],
        "max_tokens": 10
    }
    
    print("\nTesting Nvidia Deepseek v4 Flash...")
    try:
        resp_nvidia = httpx.post(url, headers=headers, json=payload_nvidia, timeout=30.0)
        print(f"Nvidia Response Status: {resp_nvidia.status_code}")
        print(f"Nvidia Response body: {resp_nvidia.text[:200]}")
    except Exception as e:
        print(f"Nvidia request failed: {e}")

if __name__ == "__main__":
    test_port(7766, "Python Proxy")
    test_port(7767, "TypeScript/Bun Proxy")
