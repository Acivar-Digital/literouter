import os

os.environ["NVIDIA_BASE_URL"] = "http://nvidia"
os.environ["NVIDIA_API_KEYS"] = "key1"
os.environ["NVIDIA_MIN_DELAY_MS"] = "100"
os.environ["MINIMAXAI_INHERITS"] = "NVIDIA"
os.environ["MINIMAXAI_MODEL"] = "minimax-1"

from src.config import LiteRouterConfig

config = LiteRouterConfig()
print("MINIMAXAI Extra params:", config.providers["minimaxai"].extra_params)
print("MINIMAXAI Model params:", config.model_params["minimaxai"])
