"""The only place that talks to an AI provider, for structured (JSON-schema) output.

Design:
* The rest of the engine depends only on the small ``StructuredLLM`` protocol,
  so tests use a fake and the app works with no API key at all.
* Two providers (D29). The provider is chosen explicitly and never falls back to the
  other one, so a key that happens to be on the machine is never used by accident:
  - ``groq`` (default): Groq's OpenAI-compatible API with strict JSON-schema output
    (constrained decoding). Text only: scanned PDFs cannot be read by AI.
  - ``anthropic``: the official Anthropic SDK with ``output_config.format`` and the
    server-side ``fallbacks: "default"`` option.
* Prompts and responses are never logged (they contain resume content).

Configuration (environment; ``scripts/dev.ps1`` loads ``engine/.env``):
    RESUME_ENGINE_LLM_PROVIDER  "groq" (default) or "anthropic"
    GROQ_API_KEY                credentials for the groq provider
    ANTHROPIC_API_KEY           credentials for the anthropic provider (ignored unless selected)
    RESUME_ENGINE_MODEL         default "openai/gpt-oss-120b" (groq) / "claude-opus-5-5" (anthropic)
    RESUME_ENGINE_LLM           set to "off" to disable AI features
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Protocol

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-opus-5-5"
GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_SCHEMA_RETRIES = 1
PROVIDERS = ("groq", "anthropic")
FALLBACK_BETA = "server-side-fallback-2026-07-01"


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


class ClaudeLLM:
    def __init__(self, client: Any | None = None, model: str | None = None):
        if client is None:
            import anthropic

            client = anthropic.Anthropic(timeout=120.0, max_retries=2)
        self.client = client
        self.model = model or os.environ.get("RESUME_ENGINE_MODEL", DEFAULT_MODEL)

    def generate_json(
        self,
        *,
        system: str,
        content: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int = 16000,
        effort: str = "medium",
    ) -> dict[str, Any]:
        import anthropic

        try:
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
                output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except anthropic.AuthenticationError:
            raise LLMError("The AI service rejected the API key. Check the engine's ANTHROPIC_API_KEY.") from None
        except anthropic.RateLimitError:
            raise LLMError("The AI service is busy right now. Please try again in a minute.") from None
        except anthropic.APIConnectionError:
            raise LLMError("Could not reach the AI service. Check the network connection.") from None
        except anthropic.APIStatusError as err:
            log.warning("AI request failed with status %s (request id %s)", err.status_code, getattr(err, "request_id", None))
            raise LLMError("The AI service returned an error. Please try again.") from None

        if response.stop_reason == "refusal":
            raise LLMError("The AI service declined this request.")
        if response.stop_reason == "max_tokens":
            raise LLMError("The AI response was too long and was cut off.")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise LLMError("The AI service returned no result.")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            raise LLMError("The AI service returned an invalid result.") from None


class GroqLLM:
    """Groq chat completions with strict JSON-schema output.

    Our schemas follow Groq's strict-mode rules (every property required, no additional
    properties; tested), so the response is constrained to valid JSON of that shape.
    """

    def __init__(self, client: Any | None = None, model: str | None = None, api_key: str | None = None):
        import httpx

        self.api_key = api_key or os.environ.get("GROQ_API_KEY", "")
        self.client = client or httpx.Client(timeout=120.0)
        self.model = model or os.environ.get("RESUME_ENGINE_MODEL") or GROQ_DEFAULT_MODEL

    def generate_json(
        self,
        *,
        system: str,
        content: list[dict[str, Any]],
        schema: dict[str, Any],
        max_tokens: int = 16000,
        effort: str = "medium",
    ) -> dict[str, Any]:
        import httpx

        if any(block.get("type") != "text" for block in content):
            raise LLMError("The configured AI (Groq) reads text only, so it cannot read scanned PDFs or images.")
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": "\n\n".join(block["text"] for block in content)},
            ],
            "response_format": {"type": "json_schema", "json_schema": {"name": "result", "strict": True, "schema": schema}},
            "max_completion_tokens": max_tokens,
        }
        for attempt in range(1 + GROQ_SCHEMA_RETRIES):
            try:
                response = self.client.post(GROQ_URL, json=body, headers={"Authorization": f"Bearer {self.api_key}"})
            except httpx.RequestError:
                raise LLMError("Could not reach the AI service. Check the network connection.") from None
            # Groq occasionally rejects its own output as not matching the schema, even in strict
            # mode (seen live with the large import schema); an immediate second try usually succeeds.
            if response.status_code == 400 and _groq_error(response).get("code") == "json_validate_failed" and attempt < GROQ_SCHEMA_RETRIES:
                log.info("AI output did not match the schema; retrying once")
                continue
            break
        if response.status_code == 401:
            raise LLMError("The AI service rejected the API key. Check the engine's GROQ_API_KEY.")
        if response.status_code == 429:
            wait = _retry_after_seconds(response.headers.get("retry-after"))
            when = f"in about {wait} seconds" if wait else "in a minute"
            raise LLMError(f"The AI usage limit for this key was reached (Groq allows a limited number of tokens per minute). Please try again {when}.")
        if response.status_code >= 400:
            # Log only Groq's error code/type: the error body can echo generated (resume) text.
            error = _groq_error(response)
            log.warning(
                "AI request failed with status %s, code %s, type %s (request id %s)",
                response.status_code, error.get("code"), error.get("type"), response.headers.get("x-request-id"),
            )
            raise LLMError("The AI service returned an error. Please try again.")

        try:
            choice = response.json()["choices"][0]
            message = choice["message"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise LLMError("The AI service returned no result.") from None
        if message.get("refusal"):
            raise LLMError("The AI service declined this request.")
        if choice.get("finish_reason") == "length":
            raise LLMError("The AI response was too long and was cut off.")
        text = message.get("content")
        if not text:
            raise LLMError("The AI service returned no result.")
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            raise LLMError("The AI service returned an invalid result.") from None
        if not isinstance(data, dict):
            raise LLMError("The AI service returned an invalid result.")
        return data


def _groq_error(response: Any) -> dict[str, Any]:
    try:
        error = response.json().get("error", {})
    except (ValueError, AttributeError):
        return {}
    return error if isinstance(error, dict) else {}


def _retry_after_seconds(value: str | None) -> int | None:
    try:
        seconds = float(value) if value else None
    except ValueError:
        return None
    return max(1, round(seconds)) if seconds is not None else None


def llm_provider() -> str:
    return os.environ.get("RESUME_ENGINE_LLM_PROVIDER", "groq").strip().lower() or "groq"


def llm_status() -> tuple[bool, str]:
    """(available, reason). Only checks configuration; makes no network call."""
    if os.environ.get("RESUME_ENGINE_LLM", "").lower() in ("off", "0", "false", "disabled"):
        return False, "AI features are turned off (RESUME_ENGINE_LLM=off)."
    provider = llm_provider()
    if provider == "groq":
        if os.environ.get("GROQ_API_KEY"):
            return True, "ok"
        return False, "No Groq API key is configured for the engine (set GROQ_API_KEY in engine/.env)."
    if provider == "anthropic":
        if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
            return True, "ok"
        return False, "No Claude API key is configured for the engine (set ANTHROPIC_API_KEY)."
    return False, f"Unknown AI provider {provider!r} (RESUME_ENGINE_LLM_PROVIDER must be one of: {', '.join(PROVIDERS)})."


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
    if not available:
        return None
    return GroqLLM() if llm_provider() == "groq" else ClaudeLLM()
