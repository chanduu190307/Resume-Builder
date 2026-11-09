"""The only place that talks to an AI service: Groq, for structured (JSON-schema) output.

Design (D29, D30):
* The rest of the engine depends only on the small ``StructuredLLM`` protocol,
  so tests use a fake and the app works with no API key at all.
* Groq only. There is no Anthropic code path, so an Anthropic key on the machine can
  never be used by this project.
* Free tier friendly: every Groq model has its own per-minute token budget (about 8,000
  tokens on the free plan), so when one model is rate limited, overloaded or answers badly,
  the request moves on to the next free model in the chain (never the same model twice).
  The first model uses strict JSON-schema output (Groq enforces the schema); fallback models
  use JSON mode and their answers are validated here (``validate.py``) before use.
* Text only: scanned PDFs cannot be read by AI (the import says so).
* Prompts and responses are never logged (they contain resume content). Error logs carry
  Groq's error code only, because error bodies can echo generated text.

Configuration (environment; ``scripts/dev.ps1`` loads ``engine/.env``):
    GROQ_API_KEY                   credentials (required for AI features)
    RESUME_ENGINE_MODEL            first model, default "openai/gpt-oss-120b"
    RESUME_ENGINE_FALLBACK_MODELS  comma-separated, default "openai/gpt-oss-20b,qwen/qwen3.8-27b"
                                   (set to "none" to disable fallback)
    RESUME_ENGINE_LLM              set to "off" to disable AI features
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Protocol

from .validate import schema_problems

log = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b"
# Free Groq models that support strict JSON-schema output (Groq structured-outputs docs).
GROQ_DEFAULT_FALLBACKS = ("openai/gpt-oss-20b", "qwen/qwen3.8-27b")


class LLMError(RuntimeError):
    """An AI request failed; the message is safe to show to the user."""


class StructuredLLM(Protocol):
    model: str

    def generate_json(
        self,
        *,
        system: str,
        content: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int = 16000,
        effort: str = "medium",
    ) -> dict[str, Any]: ...


def _env_models() -> list[str]:
    first = os.environ.get("RESUME_ENGINE_MODEL", "").strip() or GROQ_DEFAULT_MODEL
    raw = os.environ.get("RESUME_ENGINE_FALLBACK_MODELS")
    if raw is None:
        fallbacks = list(GROQ_DEFAULT_FALLBACKS)
    elif raw.strip().lower() in ("", "none", "off"):
        fallbacks = []
    else:
        fallbacks = [m.strip() for m in raw.split(",") if m.strip()]
    return list(dict.fromkeys([first, *fallbacks]))  # de-duplicated, order kept


class _TryNextModel(Exception):
    def __init__(self, reason: str, retry_after: int | None = None, busy: bool = False):
        super().__init__(reason)
        self.reason = reason  # safe to show if no model succeeds
        self.retry_after = retry_after
        self.busy = busy  # True: rate limited / overloaded (so "try again later" is the right advice)


INVALID = "The AI service returned an invalid result. Please try again."


def _json_mode_instructions(schema: dict[str, Any]) -> str:
    return (
        "\n\nOutput format: reply with a single JSON object and nothing else. It must match this JSON Schema "
        "exactly (all listed properties present, no other properties):\n" + json.dumps(schema)
    )


class GroqLLM:
    """Groq chat completions with strict JSON-schema output and a free-model fallback chain."""

    def __init__(
        self,
        client: Any | None = None,
        model: str | None = None,
        api_key: str | None = None,
        fallbacks: list[str] | None = None,
    ):
        import httpx

        self.api_key = api_key or os.environ.get("GROQ_API_KEY", "")
        self.client = client or httpx.Client(timeout=120.0)
        if model is not None:
            self.models = list(dict.fromkeys([model, *(fallbacks or [])]))
        else:
            self.models = _env_models()
        self.model = self.models[0]

    def generate_json(
        self,
        *,
        system: str,
        content: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int = 16000,
        effort: str = "medium",
    ) -> dict[str, Any]:
        if any(block.get("type") != "text" for block in content):
            raise LLMError("The AI (Groq) reads text only, so it cannot read scanned PDFs or images.")
        user = "\n\n".join(block["text"] for block in content)
        waits: list[int] = []
        any_busy = False
        last_reason = INVALID
        for i, model in enumerate(self.models):
            # The first model uses strict mode (Groq enforces the schema). Fallback models use JSON
            # mode and are validated here: in strict mode they failed on our larger schemas (D30).
            strict = i == 0
            messages = [
                {"role": "system", "content": system if strict else system + _json_mode_instructions(schema)},
                {"role": "user", "content": user},
            ]
            try:
                return self._call(model, messages, schema, max_tokens, strict)
            except _TryNextModel as nxt:
                any_busy = any_busy or nxt.busy
                last_reason = nxt.reason
                if nxt.retry_after:
                    waits.append(nxt.retry_after)
                log.info("AI model %d of %d could not answer; trying the next free model", i + 1, len(self.models))
        if not any_busy:
            raise LLMError(last_reason)
        when = f"in about {min(waits)} seconds" if waits else "in a minute"
        raise LLMError(
            "The free AI usage limit was reached for now (Groq allows a limited number of tokens per minute "
            f"for each model). Please try again {when}."
        )

    def _call(
        self, model: str, messages: list[dict[str, str]], schema: dict[str, Any], max_tokens: int, strict: bool
    ) -> dict[str, Any]:
        import httpx

        response_format: dict[str, Any] = (
            {"type": "json_schema", "json_schema": {"name": "result", "strict": True, "schema": schema}}
            if strict
            else {"type": "json_object"}
        )
        body = {"model": model, "messages": messages, "response_format": response_format, "max_completion_tokens": max_tokens}
        try:
            response = self.client.post(GROQ_URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"})
        except httpx.TimeoutException:
            raise _TryNextModel("The AI service took too long to answer. Please try again.", busy=True) from None
        except httpx.RequestError:
            raise LLMError("Could not reach the AI service. Check the network connection.") from None

        if response.status_code == 401:
            raise LLMError("The AI service rejected the API key. Check the engine's GROQ_API_KEY.")
        if response.status_code == 429 or response.status_code in (500, 502, 503, 504):
            raise _TryNextModel("The AI service is busy.", _retry_after_seconds(response.headers.get("retry-after")), busy=True)
        if response.status_code == 400 and _groq_error(response).get("code") in ("json_validate_failed", "json_generate_failed"):
            # Groq sometimes rejects its own output as not matching the schema (seen live).
            _log_error(response)
            raise _TryNextModel(INVALID)
        if response.status_code == 404:
            _log_error(response)  # model not available (e.g. retired); the next one may be
            raise _TryNextModel("The AI model is not available. Please try again later.")
        if response.status_code >= 400:
            _log_error(response)
            raise LLMError("The AI service returned an error. Please try again.")

        try:
            choice = response.json()["choices"][0]
            message = choice["message"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise _TryNextModel("The AI service returned no result.") from None
        if message.get("refusal"):
            raise LLMError("The AI service declined this request.")
        if choice.get("finish_reason") == "length":
            raise _TryNextModel("The AI response was too long and was cut off.")
        text = message.get("content")
        if not text:
            raise _TryNextModel("The AI service returned no result.")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            raise _TryNextModel(INVALID) from None
        if not isinstance(data, dict):
            raise _TryNextModel(INVALID)
        if not strict:
            problems = schema_problems(data, schema)
            if problems:
                # Count only: the problems quote paths, but never log values (they are resume text).
                log.warning("AI answer from a fallback model did not match the schema (%d problems)", len(problems))
                raise _TryNextModel(INVALID)
        return data


def _groq_error(response: Any) -> dict[str, Any]:
    try:
        error = response.json().get("error", {})
    except (ValueError, AttributeError):
        return {}
    return error if isinstance(error, dict) else {}


def _log_error(response: Any) -> None:
    """Log only Groq's error code/type, never the body (it can echo generated resume text)."""
    error = _groq_error(response)
    log.warning(
        "AI request failed with status %s, code %s, type %s (request id %s)",
        response.status_code, error.get("code"), error.get("type"), response.headers.get("x-request-id"),
    )


def _retry_after_seconds(value: str | None) -> int | None:
    try:
        seconds = float(value) if value else None
    except ValueError:
        return None
    return max(1, round(seconds)) if seconds is not None else None


def llm_status() -> tuple[bool, str]:
    """(available, reason). Only checks configuration; makes no network call."""
    if os.environ.get("RESUME_ENGINE_LLM", "").lower() in ("off", "0", "false", "disabled"):
        return False, "AI features are turned off (RESUME_ENGINE_LLM=off)."
    if os.environ.get("GROQ_API_KEY"):
        return True, "ok"
    return False, "No Groq API key is configured for the engine (set GROQ_API_KEY in engine/.env)."


_override: StructuredLLM | None = None
_has_override = False


def set_llm_for_tests(llm: StructuredLLM | None) -> None:
    """Install a fake (or None to force 'unavailable'); call reset_llm() afterwards."""
    global _override, _has_override
    _override, _has_override = llm, True


def reset_llm() -> None:
    global _override, _has_override
    _override, _has_override = None, False


def get_llm() -> StructuredLLM | None:
    if _has_override:
        return _override
    available, _ = llm_status()
    return GroqLLM() if available else None
