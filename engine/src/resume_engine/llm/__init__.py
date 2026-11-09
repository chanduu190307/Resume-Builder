"""Optional AI helpers (Groq only). Everything works without them (rules only)."""

from .client import GroqLLM, LLMError, StructuredLLM, get_llm, llm_status

__all__ = ["GroqLLM", "LLMError", "StructuredLLM", "get_llm", "llm_status"]
