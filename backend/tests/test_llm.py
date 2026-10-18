"""Model selection, the Gemini client (with a fake HTTP session) and .env loading."""

import pytest

from crispr_backend import llm, load_env
from crispr_backend.analysis.pipeline import Analyzer


class FakeResponse:
    def __init__(self, payload: dict, status: int = 200):
        self.payload, self.status_code, self.ok = payload, status, status < 400
        self.text = str(payload)

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, reply: dict, status: int = 200):
        self.reply, self.status, self.calls, self.headers = reply, status, [], {}

    def post(self, url, json, timeout):
        self.calls.append((url, json))
        return FakeResponse(self.reply, self.status)


def gemini_with(reply: dict, status: int = 200) -> tuple[llm.Gemini, FakeSession]:
    client = llm.Gemini("test-key")
    session = FakeSession(reply, status)
    client._session = session  # pyright: ignore[reportAttributeAccessIssue]
    return client, session


def gemini_reply(*parts: dict) -> dict:
    return {"candidates": [{"content": {"parts": list(parts)}}]}


@pytest.mark.parametrize(
    ("provider", "key", "expected"),
    [("none", "k", None), ("gemini", "k", "gemini"), ("", "k", "gemini"), ("", "", None), ("granite", "k", None)],
)
def test_provider_selection(monkeypatch, provider, key, expected):
    # Granite resolves to None on a laptop: no model file and no llama_cpp.
    monkeypatch.setenv("CRISPR_LLM", provider)
    monkeypatch.setenv("GEMINI_API_KEY", key)
    monkeypatch.setattr(llm, "GRANITE_SEARCH_ROOTS", ())
    llm.get_llm.cache_clear()
    model = llm.get_llm()
    assert (model.name if model else None) == expected


def test_misconfiguration_is_reported(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    for provider, message in (("gemini", "GEMINI_API_KEY is empty"), ("gpt", "Unknown CRISPR_LLM")):
        monkeypatch.setenv("CRISPR_LLM", provider)
        llm.get_llm.cache_clear()
        with pytest.raises(RuntimeError, match=message):
            llm.get_llm()


def test_gemini_request_format():
    client, session = gemini_with(gemini_reply({"text": "thinking...", "thought": True}, {"text": '["Fever"]'}))
    assert client.chat("system prompt", "I have a fever", json_output=True) == '["Fever"]'
    url, body = session.calls[0]
    assert url.endswith("/models/gemini-3.6-flash:generateContent")
    assert body["systemInstruction"] == {"parts": [{"text": "system prompt"}]}
    assert body["contents"] == [{"role": "user", "parts": [{"text": "I have a fever"}]}]
    assert body["generationConfig"] == {"responseMimeType": "application/json"}
    assert "temperature" not in str(body)  # deprecated for Gemini 3.x


def test_gemini_errors_do_not_leak_the_key():
    client, _ = gemini_with({"error": {"message": "API key not valid"}}, status=400)
    with pytest.raises(RuntimeError, match="Gemini API error 400") as error:
        client.chat("s", "u")
    assert "test-key" not in str(error.value)


def test_chat_json_parses_or_returns_none():
    client, _ = gemini_with(gemini_reply({"text": 'Sure: ["Fever", "Arthralgia"]'}))
    assert llm.chat_json(client, "s", "u") == ["Fever", "Arthralgia"]
    client, _ = gemini_with(gemini_reply({"text": "no json here"}))
    assert llm.chat_json(client, "s", "u") is None


def test_pipeline_uses_the_model_and_labels_it(database, monkeypatch):
    from crispr_backend import db

    client, _ = gemini_with(gemini_reply({"text": '[{"term": "Recurrent fever"}, "Abdominal pain"]'}))
    monkeypatch.setattr("crispr_backend.analysis.pipeline.get_llm", lambda: client)
    with db.session(database) as connection:
        analyzer = Analyzer(connection)
    terms, source = analyzer.extract_symptoms("I keep getting fevers and my belly hurts")
    assert source == "gemini"
    assert {"Recurrent fever", "Abdominal pain"} <= {t.name for t in terms}
    assert analyzer.extract_symptoms("fever", use_llm=False)[1] == "keyword"


def test_load_env_reads_values_without_overriding(tmp_path, monkeypatch):
    env = tmp_path / ".env"
    env.write_text('# comment\nGEMINI_API_KEY="abc123"\nCRISPR_LLM=gemini\n\nNOT A SETTING\n')
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("CRISPR_LLM", "none")
    load_env(env)
    import os

    assert os.environ["GEMINI_API_KEY"] == "abc123"
    assert os.environ["CRISPR_LLM"] == "none"  # already set: not overridden


def test_pipeline_falls_back_to_keywords_when_the_model_fails(database, monkeypatch):
    from crispr_backend import db

    client, _ = gemini_with({"error": "quota"}, status=429)
    monkeypatch.setattr("crispr_backend.analysis.pipeline.get_llm", lambda: client)
    with db.session(database) as connection:
        terms, source = Analyzer(connection).extract_symptoms("recurrent fever and abdominal pain")
    assert source == "keyword" and {t.name for t in terms} == {"Recurrent fever", "Abdominal pain"}
