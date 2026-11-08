"""Optional AI helpers (Groq by default, Anthropic optional). Everything works without them (rules only)."""

from .client import ClaudeLLM, GroqLLM, LLMError, StructuredLLM, get_llm, llm_provider, llm_status

__all__ = ["ClaudeLLM", "GroqLLM", "LLMError", "StructuredLLM", "get_llm", "llm_provider", "llm_status"]
