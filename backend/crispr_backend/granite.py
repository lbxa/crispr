"""IBM Granite, run locally on LinuxONE through llama.cpp.

Optional: if llama_cpp or the model file is missing (e.g. on a laptop), `get_granite()`
returns None and callers fall back to non-LLM behaviour. Set GRANITE_GGUF to the
model path, or put an *instruct* big-endian GGUF under one of SEARCH_ROOTS.

On LinuxONE the model must be a big-endian build. We use
granite-3.3-2b-instruct-be.Q4_K_M.gguf (huggingface.co/taronaeo/Granite-3.3-2B-Instruct-BE-GGUF),
the file IBM's jupyter-lab-ml demo code expects. The base model bundled in that image
(granite-4.0-h-350m-base) does not follow instructions and is never selected.
Measured speed on a 3-vCPU LinuxONE VM: about 1 token/second, so callers keep
prompts and outputs short.
"""

import glob
import json
import os
import re
import threading
from functools import cache

SEARCH_ROOTS = ("/home/ibm-user/shared/models", "/home/linux1/shared/models", "/models")


def find_model_path() -> str | None:
    if os.environ.get("GRANITE_GGUF"):
        return os.environ["GRANITE_GGUF"]
    for root in SEARCH_ROOTS:
        matches = sorted(glob.glob(os.path.join(root, "*granite*instruct*.gguf")))
        if matches:
            return matches[0]
    return None


class Granite:
    def __init__(self, model_path: str):
        from llama_cpp import Llama

        self.model_path = model_path
        self._llm = Llama(model_path=model_path, n_ctx=4096, verbose=False)
        self._lock = threading.Lock()  # llama.cpp contexts are not thread-safe

    def chat(self, system: str, user: str, max_tokens: int = 400, temperature: float = 0.2) -> str:
        with self._lock:
            response = self._llm.create_chat_completion(
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                max_tokens=max_tokens,
                temperature=temperature,
            )
        return response["choices"][0]["message"]["content"].strip()

    def chat_json(self, system: str, user: str, **kwargs) -> object | None:
        """Chat and parse the first JSON value in the reply; None if the reply has no valid JSON."""
        reply = self.chat(system, user, **kwargs)
        match = re.search(r"(\[.*\]|\{.*\})", reply, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            return None


@cache
def get_granite() -> Granite | None:
    if os.environ.get("GRANITE_DISABLED") == "1":
        return None
    path = find_model_path()
    if path is None:
        return None
    try:
        return Granite(path)
    except ImportError:
        return None
