"""Groq provider and provider selection, tested with a fake HTTP transport (no network, no key)."""

import json

import httpx
import pytest

from resume_engine.enhance.ai import SCHEMA as ENHANCE_SCHEMA
from resume_engine.jobs.cover_letter import SCHEMA as COVER_SCHEMA
from resume_engine.jobs.rewrite import SCHEMA as REWRITE_SCHEMA
from resume_engine.llm import client as llm_client
from resume_engine.llm.client import GroqLLM, LLMError, llm_status
from resume_engine.llm.extract import EXTRACTION_SCHEMA, TRANSCRIBE_SCHEMA
from resume_engine.llm.validate import UnsupportedSchema, schema_problems


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
        (httpx.Response(400, json={"error": {"code": "json_validate_failed", "failed_generation": "secret resume text"}}), "invalid result"),
        (httpx.Response(500, text="oops"), "usage limit"),
        (httpx.Response(403, json={"error": {"code": "forbidden"}}), "returned an error"),
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


ALL_SCHEMAS = pytest.mark.parametrize(
    "schema",
    [EXTRACTION_SCHEMA, TRANSCRIBE_SCHEMA, ENHANCE_SCHEMA, REWRITE_SCHEMA, COVER_SCHEMA],
    ids=["extraction", "transcribe", "enhance", "rewrite", "cover_letter"],
)


@ALL_SCHEMAS
def test_every_ai_schema_is_valid_for_groq_strict_mode(schema):
    assert _strict_problems(schema) == []


@ALL_SCHEMAS
def test_every_ai_schema_is_fully_understood_by_our_validator(schema):
    schema_problems({}, schema)  # raises UnsupportedSchema on any keyword it cannot check


# ----------------------------------------------------------------------------- configuration

@pytest.fixture
def clean_env(monkeypatch):
    for name in ("RESUME_ENGINE_LLM", "RESUME_ENGINE_LLM_PROVIDER", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
                 "ANTHROPIC_AUTH_TOKEN", "RESUME_ENGINE_MODEL", "RESUME_ENGINE_FALLBACK_MODELS"):
        monkeypatch.delenv(name, raising=False)
    llm_client.reset_llm()  # use real selection, not the autouse "no AI" override
    return monkeypatch


def test_an_anthropic_key_is_never_used(clean_env):
    clean_env.setenv("ANTHROPIC_API_KEY", "sk-ant-someone-else")
    clean_env.setenv("RESUME_ENGINE_LLM_PROVIDER", "anthropic")  # old setting: ignored now
    available, reason = llm_status()
    assert not available and "GROQ_API_KEY" in reason
    assert llm_client.get_llm() is None
    assert not hasattr(llm_client, "ClaudeLLM")


def test_groq_with_default_free_model_chain(clean_env):
    clean_env.setenv("GROQ_API_KEY", "gsk-test")
    assert llm_status() == (True, "ok")
    llm = llm_client.get_llm()
    assert isinstance(llm, GroqLLM) and llm.api_key == "gsk-test"
    assert llm.models == ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]


def test_model_chain_is_configurable(clean_env):
    clean_env.setenv("GROQ_API_KEY", "gsk-test")
    clean_env.setenv("RESUME_ENGINE_MODEL", "openai/gpt-oss-20b")
    clean_env.setenv("RESUME_ENGINE_FALLBACK_MODELS", "qwen/qwen3.8-27b, openai/gpt-oss-20b")
    assert llm_client.get_llm().models == ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
    clean_env.setenv("RESUME_ENGINE_FALLBACK_MODELS", "none")
    assert llm_client.get_llm().models == ["openai/gpt-oss-20b"]


def test_off_switch(clean_env):
    clean_env.setenv("GROQ_API_KEY", "gsk-test")
    clean_env.setenv("RESUME_ENGINE_LLM", "off")
    assert llm_status() == (False, "AI features are turned off (RESUME_ENGINE_LLM=off).")


# ----------------------------------------------------------------------------- free-model fallback

def chain(handler):
    return GroqLLM(client=httpx.Client(transport=httpx.MockTransport(handler)), model="m1", fallbacks=["m2", "m3"], api_key="k")


def test_rate_limited_model_falls_back_to_the_next_free_model():
    used = []

    def handler(request):
        model = json.loads(request.content)["model"]
        used.append(model)
        return httpx.Response(429, headers={"retry-after": "20"}, json={}) if model == "m1" else ok('{"a": 1}')

    assert chain(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={}) == {"a": 1}
    assert used == ["m1", "m2"]


@pytest.mark.parametrize("status", [500, 502, 503, 504, 404])
def test_overloaded_or_missing_model_falls_back(status):
    used = []

    def handler(request):
        model = json.loads(request.content)["model"]
        used.append(model)
        return httpx.Response(status, json={}) if model != "m3" else ok('{"a": 2}')

    assert chain(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={}) == {"a": 2}
    assert used == ["m1", "m2", "m3"]


def test_all_models_rate_limited_reports_the_shortest_wait():
    waits = {"m1": "40", "m2": "12.4", "m3": "55"}

    def handler(request):
        return httpx.Response(429, headers={"retry-after": waits[json.loads(request.content)["model"]]}, json={})

    with pytest.raises(LLMError, match="try again in about 12 seconds"):
        chain(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={})


def test_timeout_falls_back():
    used = []

    def handler(request):
        model = json.loads(request.content)["model"]
        used.append(model)
        if model == "m1":
            raise httpx.ReadTimeout("slow")
        return ok('{"a": 3}')

    assert chain(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={}) == {"a": 3}
    assert used == ["m1", "m2"]


def test_key_errors_do_not_fall_back():
    used = []

    def handler(request):
        used.append(1)
        return httpx.Response(401, json={})

    with pytest.raises(LLMError, match="GROQ_API_KEY"):
        chain(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={})
    assert len(used) == 1


def test_schema_validation_failure_moves_to_the_next_model_in_json_mode():
    seen = []
    schema = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"], "additionalProperties": False}

    def handler(request):
        body = json.loads(request.content)
        seen.append(body)
        if body["model"] == "m1":
            return httpx.Response(400, json={"error": {"code": "json_validate_failed"}})
        return ok('{"a": 1}')

    assert chain(handler).generate_json(system="sys", content=[{"type": "text", "text": "x"}], schema=schema) == {"a": 1}
    assert [b["model"] for b in seen] == ["m1", "m2"]  # never the same model twice
    assert seen[0]["response_format"]["type"] == "json_schema"
    assert seen[1]["response_format"] == {"type": "json_object"}
    fallback_system = seen[1]["messages"][0]["content"]
    assert fallback_system.startswith("sys") and json.dumps(schema) in fallback_system


def test_fallback_answers_that_do_not_match_the_schema_are_rejected():
    schema = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"], "additionalProperties": False}
    answers = {"m2": '{"a": "not a number"}', "m3": '{"a": 7}'}

    def handler(request):
        model = json.loads(request.content)["model"]
        return httpx.Response(429, json={}) if model == "m1" else ok(answers[model])

    assert chain(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema=schema) == {"a": 7}


def test_no_model_gives_a_valid_answer():
    def handler(request):
        return ok('{"unexpected": true}') if json.loads(request.content)["model"] != "m1" else httpx.Response(400, json={"error": {"code": "json_validate_failed"}})

    schema = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"], "additionalProperties": False}
    with pytest.raises(LLMError, match="invalid result"):
        chain(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema=schema)


def test_other_errors_are_not_retried():
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(400, json={"error": {"code": "invalid_request_error"}})

    with pytest.raises(LLMError):
        groq(handler).generate_json(system="s", content=[{"type": "text", "text": "x"}], schema={})
    assert len(calls) == 1


# ----------------------------------------------------------------------------- validator

def test_validator_accepts_and_rejects_the_right_shapes():
    schema = {
        "type": "object",
        "properties": {
            "name": {"anyOf": [{"type": "string"}, {"type": "null"}]},
            "kind": {"type": "string", "enum": ["a", "b"]},
            "items": {"type": "array", "items": {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"], "additionalProperties": False}},
            "flag": {"type": "boolean"},
        },
        "required": ["name", "kind", "items", "flag"],
        "additionalProperties": False,
    }
    good = {"name": None, "kind": "a", "items": [{"n": 1}], "flag": False}
    assert schema_problems(good, schema) == []
    assert schema_problems({**good, "name": 3}, schema)                 # anyOf: neither string nor null
    assert schema_problems({**good, "kind": "c"}, schema)               # enum
    assert schema_problems({**good, "items": [{"n": True}]}, schema)    # a bool is not an integer
    assert schema_problems({**good, "items": [{"n": 1, "x": 2}]}, schema)  # additionalProperties
    assert schema_problems({k: v for k, v in good.items() if k != "flag"}, schema)  # required
    assert schema_problems([good], schema)                              # wrong top-level type


def test_validator_refuses_keywords_it_does_not_understand():
    with pytest.raises(UnsupportedSchema):
        schema_problems("x", {"type": "string", "pattern": "^a"})
