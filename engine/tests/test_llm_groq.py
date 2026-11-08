"""Groq provider and provider selection, tested with a fake HTTP transport (no network, no key)."""

import json

import httpx
import pytest

from resume_engine.enhance.ai import SCHEMA as ENHANCE_SCHEMA
from resume_engine.jobs.cover_letter import SCHEMA as COVER_SCHEMA
from resume_engine.jobs.rewrite import SCHEMA as REWRITE_SCHEMA
from resume_engine.llm import client as llm_client
from resume_engine.llm.client import GroqLLM, LLMError, llm_provider, llm_status
from resume_engine.llm.extract import EXTRACTION_SCHEMA, TRANSCRIBE_SCHEMA


def groq(handler, model="openai/gpt-oss-120b"):
    return GroqLLM(client=httpx.Client(transport=httpx.MockTransport(handler)), model=model, api_key="test-key")


def ok(content, finish_reason="stop", **message):
    return httpx.Response(200, json={"choices": [{"finish_reason": finish_reason, "message": {"content": content, **message}}]})


def test_request_shape_and_parsing():
    seen = {}

    def handler(request: httpx.Request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return ok('{"a": 1}')

    schema = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"], "additionalProperties": False}
    out = groq(handler).generate_json(
        system="sys", content=[{"type": "text", "text": "one"}, {"type": "text", "text": "two"}], schema=schema, max_tokens=500
    )
    assert out == {"a": 1}
    assert seen["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert seen["auth"] == "Bearer test-key"
    body = seen["body"]
    assert body["model"] == "openai/gpt-oss-120b"
    assert body["messages"] == [{"role": "system", "content": "sys"}, {"role": "user", "content": "one\n\ntwo"}]
    assert body["response_format"] == {"type": "json_schema", "json_schema": {"name": "result", "strict": True, "schema": schema}}
    assert body["max_completion_tokens"] == 500


def test_non_text_content_is_refused_without_a_request():
    def handler(request):
        raise AssertionError("no request expected")

    pdf = {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": "AAAA"}}
    with pytest.raises(LLMError, match="reads text only"):
        groq(handler).generate_json(system="s", content=[pdf], schema={})


@pytest.mark.parametrize(
    "response, message",
    [
        (httpx.Response(401, json={"error": {"code": "invalid_api_key"}}), "GROQ_API_KEY"),
        (httpx.Response(429, headers={"retry-after": "31.2"}, json={}), "try again in about 31 seconds"),
        (httpx.Response(429, json={}), "try again in a minute"),
        (httpx.Response(400, json={"error": {"code": "json_validate_failed", "failed_generation": "secret resume text"}}), "returned an error"),
        (httpx.Response(500, text="oops"), "returned an error"),
        (ok(None), "no result"),
        (ok("not json"), "invalid result"),
        (ok("[1, 2]"), "invalid result"),
        (ok('{"a": 1}', finish_reason="length"), "cut off"),
        (ok(None, refusal="no"), "declined"),
        (httpx.Response(200, json={"choices": []}), "no result"),
    ],
)
def test_errors_become_safe_messages(response, message):
    with pytest.raises(LLMError, match=message):
        groq(lambda request: response).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={})


def test_error_logs_never_contain_generated_text(caplog):
    response = httpx.Response(400, json={"error": {"code": "json_validate_failed", "type": "invalid_request_error", "failed_generation": "Jane Doe, secret"}})
    with pytest.raises(LLMError):
        groq(lambda request: response).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={})
    assert "json_validate_failed" in caplog.text
    assert "Jane Doe" not in caplog.text


def test_connection_errors_are_reported():
    def handler(request):
        raise httpx.ConnectError("down")

    with pytest.raises(LLMError, match="Could not reach"):
        groq(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={})


def _strict_problems(schema, path="$"):
    """Groq strict mode: every object lists all properties as required and forbids extra properties."""
    problems = []
    if isinstance(schema, dict):
        if schema.get("type") == "object" or "properties" in schema:
            missing = set(schema.get("properties", {})) - set(schema.get("required", []))
            if missing:
                problems.append(f"{path}: not required {sorted(missing)}")
            if schema.get("additionalProperties") is not False:
                problems.append(f"{path}: additionalProperties must be false")
        for key, value in schema.items():
            if key in ("properties", "$defs"):
                for name, sub in value.items():
                    problems += _strict_problems(sub, f"{path}.{name}")
            elif isinstance(value, (dict, list)):
                problems += _strict_problems(value, f"{path}.{key}")
    elif isinstance(schema, list):
        for i, sub in enumerate(schema):
            problems += _strict_problems(sub, f"{path}[{i}]")
    return problems


@pytest.mark.parametrize(
    "schema",
    [EXTRACTION_SCHEMA, TRANSCRIBE_SCHEMA, ENHANCE_SCHEMA, REWRITE_SCHEMA, COVER_SCHEMA],
    ids=["extraction", "transcribe", "enhance", "rewrite", "cover_letter"],
)
def test_every_ai_schema_is_valid_for_groq_strict_mode(schema):
    assert _strict_problems(schema) == []


# ----------------------------------------------------------------------------- provider selection

@pytest.fixture
def clean_env(monkeypatch):
    for name in ("RESUME_ENGINE_LLM", "RESUME_ENGINE_LLM_PROVIDER", "GROQ_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "RESUME_ENGINE_MODEL"):
        monkeypatch.delenv(name, raising=False)
    llm_client.reset_llm()  # use real selection, not the autouse "no AI" override
    return monkeypatch


def test_groq_is_the_default_and_an_anthropic_key_alone_is_never_used(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "sk-ant-someone-else")
    assert llm_provider() == "groq"
    available, reason = llm_status()
    assert not available and "GROQ_API_KEY" in reason
    assert llm_client.get_llm() is None


def test_groq_selected_when_its_key_is_set(clean_env):
    clean_env.setenv("GROQ_API_KEY", "gsk-test")
    clean_env.setenv("ANTHROPIC_API_KEY", "sk-ant-someone-else")
    assert llm_status() == (True, "ok")
    llm = llm_client.get_llm()
    assert isinstance(llm, GroqLLM) and llm.model == "openai/gpt-oss-120b" and llm.api_key == "gsk-test"


def test_anthropic_only_when_explicitly_chosen(clean_env):
    clean_env.setenv("RESUME_ENGINE_LLM_PROVIDER", "anthropic")
    clean_env.setenv("GROQ_API_KEY", "gsk-test")
    assert not llm_status()[0]  # a Groq key does not enable the Anthropic provider
    clean_env.setenv("ANTHROPIC_API_KEY", "sk-ant-test")
    assert llm_status() == (True, "ok")


def test_off_switch_and_unknown_provider(clean_env):
    clean_env.setenv("GROQ_API_KEY", "gsk-test")
    clean_env.setenv("RESUME_ENGINE_LLM", "off")
    assert llm_status() == (False, "AI features are turned off (RESUME_ENGINE_LLM=off).")
    clean_env.delenv("RESUME_ENGINE_LLM")
    clean_env.setenv("RESUME_ENGINE_LLM_PROVIDER", "openai")
    available, reason = llm_status()
    assert not available and "Unknown AI provider" in reason


def test_schema_validation_failure_is_retried_once():
    calls = []
    bad = httpx.Response(400, json={"error": {"code": "json_validate_failed", "failed_generation": "x"}})

    def handler(request):
        calls.append(1)
        return bad if len(calls) == 1 else ok('{"a": 1}')

    assert groq(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={}) == {"a": 1}
    assert len(calls) == 2


def test_schema_validation_failure_twice_gives_up():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(400, json={"error": {"code": "json_validate_failed"}})

    with pytest.raises(LLMError, match="returned an error"):
        groq(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={})
    assert len(calls) == 2


def test_other_errors_are_not_retried():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(400, json={"error": {"code": "invalid_request_error"}})

    with pytest.raises(LLMError):
        groq(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={})
    assert len(calls) == 1
