from src.config import get_model_limits

def run_tests():
    print("Running limits logic tests...")
    
    # 1. Test nvidia provider fallback
    nvidia_limits = get_model_limits("nvidia/deepseek-ai/deepseek-v4-pro", "nvidia")
    print(f"Nvidia limits: {nvidia_limits}")
    assert nvidia_limits["max_rpm"] == 40
    assert nvidia_limits["max_tpm"] == 1000000
    
    # 2. Test openrouter provider fallback
    openrouter_limits = get_model_limits("nvidia/nemotron-3-nano-30b-a3b:free", "openrouter")
    print(f"OpenRouter limits: {openrouter_limits}")
    assert openrouter_limits["max_rpm"] == 20
    assert openrouter_limits["max_tpm"] == 1000000

    # 3. Test explicit model matching (gemini-3.1-flash-lite)
    gemini_limits = get_model_limits("gemini-3.1-flash-lite", "google")
    print(f"Gemini limits: {gemini_limits}")
    assert gemini_limits["max_rpm"] == 15
    assert gemini_limits["max_tpm"] == 250000

    # 4. Test provider/model differentiation to prevent collisions on same model name
    # e.g., if we had a specific model limit under "google/gemma" but a model named "gemma" is queried on "zen" provider
    zen_gemma_limits = get_model_limits("gemma", "zen")
    print(f"Zen Gemma limits: {zen_gemma_limits}")
    # Should fall back to default limits (15 RPM) since Zen has no provider limits and google/gemma should not match Zen
    assert zen_gemma_limits["max_rpm"] == 15
    assert zen_gemma_limits["max_tpm"] == 1000000

    google_gemma_limits = get_model_limits("gemma", "google")
    print(f"Google Gemma limits: {google_gemma_limits}")
    # Should match google/gemma (15 RPM, but max_tpm: 100000000)
    assert google_gemma_limits["max_rpm"] == 15
    assert google_gemma_limits["max_tpm"] == 100000000

    # 5. Test fallback to default limits
    default_limits = get_model_limits("some-other-model", "unknown")
    print(f"Default limits: {default_limits}")
    assert default_limits["max_rpm"] == 15
    assert default_limits["max_tpm"] == 1000000

    print("All limits logic tests passed successfully!")

if __name__ == "__main__":
    run_tests()
