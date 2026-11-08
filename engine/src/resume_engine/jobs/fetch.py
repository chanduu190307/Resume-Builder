"""Import a job description from a link.

Security (SSRF): the engine fetches the page, so a URL could point at the
user's own network. Only http/https on standard ports are allowed; the host is
resolved and every address must be public; each redirect is re-checked; size and
time are capped. (A DNS answer could still change between the check and the
request; acceptable for a local single-user engine, see DECISIONS.md.)

Extraction prefers structured JobPosting data (JSON-LD), which many job sites
embed, then falls back to the page's main text.
"""

from __future__ import annotations

import ipaddress
import json
import re
import socket
from dataclasses import dataclass
from typing import Callable
from urllib.parse import urljoin, urlsplit

import httpx
from lxml import html as lxml_html

MAX_BYTES = 2 * 1024 * 1024
TIMEOUT = 10.0
MAX_REDIRECTS = 5
USER_AGENT = "ResumeBuilder/0.1 (+job description import for a single user)"


class JobFetchError(ValueError):
    """Message is safe to show to the user."""


@dataclass
class FetchedJob:
    url: str
    text: str
    title: str | None
    company: str | None
    source: str  # "jsonld" | "page"


Resolver = Callable[[str], list[str]]


def _resolve(host: str) -> list[str]:
    try:
        return list({info[4][0] for info in socket.getaddrinfo(host, None)})
    except socket.gaierror:
        raise JobFetchError("That web address could not be found. Check the link.") from None


def check_url(url: str, resolve: Resolver = _resolve) -> str:
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise JobFetchError("Only http and https links are supported.")
    if not parts.hostname:
        raise JobFetchError("That does not look like a complete web address.")
    if parts.username or parts.password:
        raise JobFetchError("Links containing a username or password are not supported.")
    if parts.port not in (None, 80, 443):
        raise JobFetchError("Links to non-standard ports are not supported.")
    host = parts.hostname
    try:
        addresses = [host] if ipaddress.ip_address(host) else []
    except ValueError:
        addresses = resolve(host)
    for addr in addresses:
        ip = ipaddress.ip_address(addr.split("%")[0])
        if not ip.is_global or ip.is_multicast:
            raise JobFetchError("That link points to a private or local network address, which is not allowed.")
    return url.strip()


# ----------------------------------------------------------------------------- extraction

_BLOCK = {"p", "div", "section", "article", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "header", "footer"}


def html_to_text(fragment: str) -> str:
    """HTML -> readable text with line breaks and "• " for list items."""
    if not fragment.strip():
        return ""
    doc = lxml_html.fromstring(f"<div>{fragment}</div>")
    for bad in doc.xpath("//script|//style|//noscript|//svg|//form|//nav|//iframe"):
        bad.drop_tree()
    out: list[str] = []

    def walk(el) -> None:
        tag = el.tag if isinstance(el.tag, str) else ""
        if tag == "li":
            out.append("\n• ")
        elif tag in _BLOCK:
            out.append("\n")
        if el.text:
            out.append(el.text)
        for child in el:
            walk(child)
            if child.tail:
                out.append(child.tail)
        if tag in _BLOCK and tag != "li":  # the next item starts its own line
            out.append("\n")

    walk(doc)
    text = "".join(out)
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _job_postings(doc) -> list[dict]:
    found = []
    for node in doc.xpath('//script[@type="application/ld+json"]'):
        try:
            data = json.loads(node.text_content())
        except (json.JSONDecodeError, TypeError):
            continue
        stack = data if isinstance(data, list) else [data]
        while stack:
            item = stack.pop()
            if isinstance(item, dict):
                kind = item.get("@type")
                if kind == "JobPosting" or (isinstance(kind, list) and "JobPosting" in kind):
                    found.append(item)
                stack.extend(v for k, v in item.items() if k == "@graph" or isinstance(v, (dict, list)))
            elif isinstance(item, list):
                stack.extend(item)
    return found


def extract_job(page: str, url: str = "") -> FetchedJob:
    doc = lxml_html.fromstring(page)
    for posting in _job_postings(doc):
        description = html_to_text(str(posting.get("description") or ""))
        if len(description.split()) >= 30:
            org = posting.get("hiringOrganization")
            company = org.get("name") if isinstance(org, dict) else (org if isinstance(org, str) else None)
            title = posting.get("title")
            text = (f"{title}\n\n" if title else "") + description
            return FetchedJob(url=url, text=text, title=title, company=company, source="jsonld")

    for bad in doc.xpath("//script|//style|//noscript|//svg|//nav|//header|//footer|//form|//aside|//iframe"):
        bad.drop_tree()
    main = doc.xpath("//main") or doc.xpath("//article") or doc.xpath("//body") or [doc]
    text = html_to_text(lxml_html.tostring(main[0], encoding="unicode"))
    title_el = doc.xpath("//h1")
    title = title_el[0].text_content().strip() if title_el else None
    if len(text.split()) < 40:
        raise JobFetchError(
            "We could not find a job description on that page. Many job sites load it with scripts or block "
            "automated access; copy the job text and paste it instead."
        )
    return FetchedJob(url=url, text=text, title=title or None, company=None, source="page")


def fetch_job(url: str, client: httpx.Client | None = None, resolve: Resolver = _resolve) -> FetchedJob:
    current = check_url(url, resolve)
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": USER_AGENT})
    try:
        for _ in range(MAX_REDIRECTS + 1):
            try:
                with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise JobFetchError("The page redirected without a destination.")
                        current = check_url(urljoin(current, location), resolve)
                        continue
                    if response.status_code in (401, 403, 429):
                        raise JobFetchError("That site does not allow automated access. Copy the job text and paste it instead.")
                    if response.status_code >= 400:
                        raise JobFetchError(f"The page could not be loaded (error {response.status_code}).")
                    content_type = response.headers.get("content-type", "")
                    if not any(t in content_type for t in ("text/html", "text/plain", "application/xhtml")):
                        raise JobFetchError("That link is not a web page. Paste the job text instead.")
                    body = b""
                    for chunk in response.iter_bytes():
                        body += chunk
                        if len(body) > MAX_BYTES:
                            raise JobFetchError("That page is too large.")
                    page = body.decode(response.encoding or "utf-8", errors="replace")
                    if "text/plain" in content_type:
                        return FetchedJob(url=current, text=page.strip(), title=None, company=None, source="page")
                    return extract_job(page, current)
            except httpx.TimeoutException:
                raise JobFetchError("The page took too long to respond.") from None
            except httpx.HTTPError:
                raise JobFetchError("The page could not be loaded. Check the link, or paste the job text instead.") from None
        raise JobFetchError("The page redirected too many times.")
    finally:
        if own:
            client.close()
