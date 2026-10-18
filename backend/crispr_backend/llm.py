"""The language model that reads symptom text: Google Gemini (API) or IBM Granite (local).

Chosen by CRISPR_LLM in backend/.env (see .env.example):
- `gemini`: Gemini via the Gemini API; needs GEMINI_API_KEY. Fast, but symptom text is
  sent to Google.
- `granite`: IBM Granite 3.3 2B in-process via llama.cpp on LinuxONE. Nothing leaves the
  server, but it runs at ~1 token/s on the 3-vCPU VM. The model must be a big-endian
  build: granite-3.3-2b-instruct-be.Q4_K_M.gguf from
  huggingface.co/taronaeo/Granite-3.3-2B-Instruct-BE-GGUF (the base model bundled in
  IBM's image can't follow instructions and is never selected).
- `none`: no model; callers fall back to keyword matching and templates.
Unset: Gemini if GEMINI_API_KEY is set, otherwise Granite if available.

`get_llm()` returns None whenever the chosen model is unavailable, so callers always
have a non-LLM fallback.
"""

import glob
import json
import os
import re
import threading
from functools import cache
from typing import Protocol

import requests

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
GRANITE_SEARCH_ROOTS = ("/home/ibm-user/shared/models", "/home/linux1/shared/models", "/models")


class LLM(Protocol):
    name: str

    def chat(self, system: str, user: str, max_tokens: int = 400, json_output: bool = False) -> str: ...


def chat_json(llm: LLM, system: str, user: str, max_tokens: int = 400) -> object | None:
    """Chat and parse the first JSON value in the reply; None if the reply has no valid JSON."""
    reply = llm.chat(system, user, max_tokens, json_output=True)
    match = re.search(r"(\[.*\]|\{.*\})", reply, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return None


class Gemini:
    name = "gemini"

    def __init__(self, api_key: str, model: str = DEFAULT_GEMINI_MODEL):
        self.model = model
        self._session = requests.Session()
        self._session.headers.update({"x-goog-api-key": api_key, "Content-Type": "application/json"})

    def chat(self, system: str, user: str, max_tokens: int = 400, json_output: bool = False) -> str:
        # max_tokens is not forwarded: Gemini's thinking tokens count toward the output
        # limit, and a small cap can leave no room for the answer. Temperature is
        # deprecated for Gemini 3.x and ignored, so it isn't sent either.
        body: dict = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
        }
        if json_output:
            body["generationConfig"] = {"responseMimeType": "application/json"}
        response = self._session.post(GEMINI_URL.format(model=self.model), json=body, timeout=60)
        if not response.ok:
            # Never echo the request: its headers carry the API key.
            raise RuntimeError(f"Gemini API error {response.status_code}: {response.text[:300]}")
        candidates = response.json().get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        return "".join(part.get("text", "") for part in parts if not part.get("thought")).strip()


class Granite:
    name = "granite"

    def __init__(self, model_path: str):
        from llama_cpp import Llama  # pyright: ignore[reportMissingImports]  (server-only dependency)

        self.model_path = model_path
        self._llm = Llama(model_path=model_path, n_ctx=4096, verbose=False)
        self._lock = threading.Lock()  # llama.cpp contexts are not thread-safe

    def chat(self, system: str, user: str, max_tokens: int = 400, json_output: bool = False) -> str:
        with self._lock:
            response = self._llm.create_chat_completion(
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                max_tokens=max_tokens,
                temperature=0.2,
            )
        return response["choices"][0]["message"]["content"].strip()


def find_granite_model() -> str | None:
    if os.environ.get("GRANITE_GGUF") and os.path.exists(os.environ["GRANITE_GGUF"]):
        return os.environ["GRANITE_GGUF"]
    for root in GRANITE_SEARCH_ROOTS:
        matches = sorted(glob.glob(os.path.join(root, "*granite*instruct*.gguf")))
        if matches:
            return matches[0]
    return None


def _granite() -> Granite | None:
    path = find_granite_model()
    if path is None:
        return None
    try:
        return Granite(path)
    except ImportError:
        return None  # llama_cpp is only installed on the server


@cache
def get_llm() -> LLM | None:
    provider = os.environ.get("CRISPR_LLM", "").strip().lower()
    # Docker's --env-file keeps quotes as part of the value, so strip any.
    api_key = os.environ.get("GEMINI_API_KEY", "").strip().strip("'\"")
    if provider == "none":
        return None
    if provider == "gemini" or (not provider and api_key):
        if not api_key:
            raise RuntimeError("CRISPR_LLM=gemini but GEMINI_API_KEY is empty; set it in backend/.env")
        return Gemini(api_key, os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL))
    if provider not in ("", "granite"):
        raise RuntimeError(f"Unknown CRISPR_LLM={provider!r}; use gemini, granite or none")
    return _granite()
