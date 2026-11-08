"""Contact details: email, phone, links, location, name and headline."""

from __future__ import annotations

import re

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_CANDIDATE = re.compile(r"(?<![\w])(\+?\(?\d[\d\s().\-]{6,}\d)(?![\w])")
_YEAR_RANGE = re.compile(r"^\s*(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\s*$")

_TLDS = (
    "com|org|net|io|dev|me|in|co|ai|app|xyz|edu|gov|uk|ca|de|fr|es|it|nl|au|info|tech|site|page|"
    "online|blog|design|studio|cloud|so|sh|us|eu|ch|jp|sg|nz|ie|se|no|dk|fi|pl|pt|br|mx|za"
)
URL_RE = re.compile(
    rf"(?<![@\w.])((?:https?://)?(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.(?:{_TLDS})(?:/[^\s|,;]*)?)(?![\w@])",
    re.IGNORECASE,
)

# "Austin, TX", "Madrid, Spain", "Bengaluru, Karnataka", "Remote", "New York, NY, USA".
_PLACE_WORD = r"[A-ZÀ-Ý][A-Za-zÀ-ÿ'.\-]+"
LOCATION_RE = re.compile(rf"^(?:{_PLACE_WORD}(?: {_PLACE_WORD}){{0,2}})(?:, ?{_PLACE_WORD}(?: {_PLACE_WORD}){{0,2}}){{1,2}}$")
REMOTE_RE = re.compile(r"^(?:remote|hybrid|on-?site|work from home)(?:\s*\(.*\))?$", re.IGNORECASE)

MULTI_WORD_CITIES = {
    "new york", "san francisco", "los angeles", "san diego", "san jose", "hong kong", "new delhi",
    "tel aviv", "buenos aires", "kuala lumpur", "cape town", "mexico city", "las vegas", "st. louis",
    "salt lake city", "rio de janeiro", "sao paulo", "são paulo", "abu dhabi", "navi mumbai", "ho chi minh city",
}

_SEPARATORS = re.compile(r"\s*(?:\||•|·|◦|▪|—|\t)\s*|\s{2,}")


def find_emails(text: str) -> list[str]:
    return EMAIL_RE.findall(text)


def find_phones(text: str) -> list[str]:
    out = []
    for m in _PHONE_CANDIDATE.finditer(text):
        candidate = m.group(1).strip(" .-")
        digits = re.sub(r"\D", "", candidate)
        if 9 <= len(digits) <= 15 and not _YEAR_RANGE.match(candidate):
            out.append(candidate)
    return out


def find_urls(text: str) -> list[str]:
    no_emails = EMAIL_RE.sub(" ", text)
    return [m.group(1).rstrip(".)") for m in URL_RE.finditer(no_emails)]


def link_kind(url: str) -> str:
    u = url.lower()
    if "linkedin.com" in u:
        return "linkedin"
    if "github.com" in u or "gitlab.com" in u:
        return "github"
    return "website"


def is_location(text: str) -> bool:
    t = text.strip()
    if not t or len(t) > 50 or any(ch.isdigit() for ch in t):
        return False
    return bool(LOCATION_RE.match(t) or REMOTE_RE.match(t))


_REGIONS = {
    # Countries (English names) and common short forms.
    "usa", "us", "united states", "uk", "united kingdom", "england", "scotland", "wales", "ireland", "canada",
    "australia", "new zealand", "india", "germany", "france", "spain", "italy", "portugal", "netherlands",
    "belgium", "switzerland", "austria", "sweden", "norway", "denmark", "finland", "poland", "czechia",
    "japan", "china", "singapore", "malaysia", "indonesia", "philippines", "vietnam", "thailand", "korea",
    "south korea", "uae", "united arab emirates", "saudi arabia", "qatar", "israel", "turkey", "egypt",
    "nigeria", "kenya", "south africa", "ghana", "brazil", "mexico", "argentina", "chile", "colombia", "peru",
    "pakistan", "bangladesh", "sri lanka", "nepal", "hong kong", "taiwan",
    # Indian states and UTs commonly written in addresses.
    "karnataka", "maharashtra", "tamil nadu", "kerala", "telangana", "andhra pradesh", "gujarat", "rajasthan",
    "west bengal", "uttar pradesh", "madhya pradesh", "punjab", "haryana", "delhi", "goa", "odisha", "bihar",
    "assam", "jharkhand", "chhattisgarh", "uttarakhand", "himachal pradesh", "jammu and kashmir",
}


def is_strict_location(text: str) -> bool:
    """Location that cannot be confused with a job title: "Austin, TX", "Madrid, Spain", "Remote"."""
    t = text.strip()
    if REMOTE_RE.match(t):
        return True
    if not is_location(t) or "," not in t:
        return False
    last = t.rsplit(",", 1)[1].strip()
    return bool(re.fullmatch(r"[A-Z]{2}", last)) or last.lower() in _REGIONS


def is_short_place(text: str) -> bool:
    """A right-aligned short place name such as "Bengaluru" or "Remote" (layout says it is a location)."""
    t = text.strip()
    if not t or any(ch.isdigit() for ch in t) or len(t.split()) > 4 or len(t) > 40:
        return False
    return is_location(t) or bool(re.fullmatch(rf"{_PLACE_WORD}(?: {_PLACE_WORD}){{0,2}}", t))


def split_trailing_location(text: str) -> tuple[str, str | None]:
    """Split "Contoso Payments Austin, TX" -> ("Contoso Payments", "Austin, TX").

    Used only when layout did not separate the location (pasted text). Takes
    one city word (or a known multi-word city) before the comma.
    """
    t = text.strip()
    m = re.search(r"\s(Remote|Hybrid|On-?site)$", t, re.IGNORECASE)
    if m and m.start() > 0:
        return t[: m.start()].strip(" ,|·"), m.group(1)
    m = re.search(rf"(?:^|\s)((?:{_PLACE_WORD} ){{0,3}}{_PLACE_WORD}), ?({_PLACE_WORD}(?: {_PLACE_WORD})?)$", t)
    if not m:
        return t, None
    words = m.group(1).split(" ")
    city = words[-1]
    for n in (3, 2):
        if len(words) >= n and " ".join(words[-n:]).lower() in MULTI_WORD_CITIES:
            city = " ".join(words[-n:])
            break
    location = f"{city}, {m.group(2)}"
    head = t[: len(t) - len(location)].strip(" ,|·")
    if not head:
        return t, None
    return head, location


def split_contact_parts(text: str) -> list[str]:
    return [p.strip() for p in _SEPARATORS.split(text) if p and p.strip()]


def looks_like_name(text: str) -> bool:
    t = text.strip()
    if not t or len(t) > 60 or any(ch.isdigit() for ch in t) or "@" in t:
        return False
    words = t.replace(",", " ").split()
    if not 1 <= len(words) <= 5:
        return False
    letters = sum(ch.isalpha() for ch in t)
    return letters / max(len(t.replace(" ", "")), 1) > 0.8
