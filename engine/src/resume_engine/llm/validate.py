"""Minimal JSON Schema validator for the subset our AI schemas use.

Used when a Groq model answers in plain JSON mode (no server-side schema enforcement): the answer
is only accepted if it has exactly the shape the rest of the engine expects. Supported keywords:
type (incl. lists of types), enum, anyOf, properties, required, additionalProperties: false, items.
Any other keyword in a schema is an error, so the validator can never silently accept something it
does not understand (a test checks every AI schema).
"""

from __future__ import annotations

from typing import Any

SUPPORTED = {"type", "enum", "anyOf", "properties", "required", "additionalProperties", "items"}

_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "null": lambda v: v is None,
}


class UnsupportedSchema(ValueError):
    pass


def schema_problems(value: Any, schema: dict[str, Any], path: str = "$") -> list[str]:
    """Every way `value` does not match `schema` (empty list = valid)."""
    unknown = set(schema) - SUPPORTED
    if unknown:
        raise UnsupportedSchema(f"{path}: unsupported schema keywords {sorted(unknown)}")

    if "anyOf" in schema:
        options = [schema_problems(value, option, path) for option in schema["anyOf"]]
        if all(options):
            return [f"{path}: matches none of the allowed forms"]
        rest = {k: v for k, v in schema.items() if k != "anyOf"}
        return schema_problems(value, rest, path) if rest else []

    problems: list[str] = []
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        for t in types:
            if t not in _TYPES:
                raise UnsupportedSchema(f"{path}: unsupported type {t!r}")
        if not any(_TYPES[t](value) for t in types):
            return [f"{path}: expected {' or '.join(types)}"]
    if "enum" in schema and value not in schema["enum"]:
        problems.append(f"{path}: {value!r} is not one of the allowed values")

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                problems.append(f"{path}: missing {name!r}")
        if schema.get("additionalProperties") is False:
            extra = sorted(set(value) - set(properties))
            if extra:
                problems.append(f"{path}: unexpected {extra}")
        for name, sub in properties.items():
            if name in value:
                problems += schema_problems(value[name], sub, f"{path}.{name}")
    if isinstance(value, list) and "items" in schema:
        for i, item in enumerate(value):
            problems += schema_problems(item, schema["items"], f"{path}[{i}]")
    return problems
