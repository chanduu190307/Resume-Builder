"""Detect the real file type from its bytes (never trust the file name alone)."""

from __future__ import annotations

import zipfile
from enum import Enum
from io import BytesIO


class FileKind(str, Enum):
    PDF = "pdf"
    DOCX = "docx"
    TEXT = "text"


class UnsupportedFile(ValueError):
    """Raised with a message that is safe to show to the user."""


MAX_BYTES = 5 * 1024 * 1024


def sniff_kind(data: bytes, filename: str = "") -> FileKind:
    if len(data) == 0:
        raise UnsupportedFile("The file is empty.")
    if len(data) > MAX_BYTES:
        raise UnsupportedFile("The file is larger than 5 MB.")
    if data[:5] == b"%PDF-":
        return FileKind.PDF
    if data[:4] == b"PK\x03\x04":
        try:
            with zipfile.ZipFile(BytesIO(data)) as zf:
                if "word/document.xml" in zf.namelist():
                    return FileKind.DOCX
        except zipfile.BadZipFile:
            pass
        raise UnsupportedFile("This looks like a ZIP or Office file that is not a Word (.docx) document.")
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise UnsupportedFile("Old Word .doc files are not supported. Save it as .docx or PDF and try again.")
    if _looks_like_text(data):
        return FileKind.TEXT
    name = filename.lower()
    hint = " Save it as PDF, DOCX or TXT." if not name.endswith((".pdf", ".docx", ".txt")) else ""
    raise UnsupportedFile(f"This file type is not supported.{hint}")


def _looks_like_text(data: bytes) -> bool:
    sample = data[:4096]
    if sample.startswith((b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff")):
        return True
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
        return True
    except UnicodeDecodeError as err:
        # A multi-byte character may be cut at the sample boundary.
        if err.start >= len(sample) - 4:
            return True
    printable = sum(32 <= b < 127 or b in (9, 10, 13) or b >= 160 for b in sample)
    return printable / len(sample) > 0.95


def decode_text(data: bytes) -> str:
    """Decode text files: BOM-aware, UTF-8 first, then Windows-1252."""
    for bom, enc in ((b"\xef\xbb\xbf", "utf-8"), (b"\xff\xfe", "utf-16-le"), (b"\xfe\xff", "utf-16-be")):
        if data.startswith(bom):
            return data[len(bom):].decode(enc, errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")
