"""Job description import from a link: SSRF protection and extraction (network mocked)."""

import json

import httpx
import pytest

from resume_engine.jobs.fetch import JobFetchError, check_url, extract_job, fetch_job, html_to_text


def public(host):
    return ["93.184.216.34"]


@pytest.mark.parametrize("url, message", [
    ("file:///etc/passwd", "Only http and https"),
    ("ftp://example.com/job", "Only http and https"),
    ("http://localhost/job", "private or local"),
    ("http://127.0.0.1/job", "private or local"),
    ("http://10.0.0.5/job", "private or local"),
    ("http://192.168.1.1/admin", "private or local"),
    ("http://169.254.169.254/latest/meta-data", "private or local"),
    ("http://[::1]/job", "private or local"),
    ("http://example.com:8080/job", "non-standard ports"),
    ("http://user:pass@example.com/job", "username or password"),
    ("https:///nohost", "complete web address"),
])
def test_unsafe_urls_are_rejected(url, message):
    resolver = (lambda h: ["127.0.0.1"]) if "localhost" in url else public
    with pytest.raises(JobFetchError, match=message):
        check_url(url, resolver)


def test_hostname_resolving_to_private_address_is_rejected():
    with pytest.raises(JobFetchError, match="private or local"):
        check_url("https://internal.example.com/job", lambda h: ["10.1.2.3"])


def test_public_url_is_allowed():
    assert check_url("https://jobs.example.com/123", public) == "https://jobs.example.com/123"


DESCRIPTION = "<p>We are hiring a data analyst.</p><h3>Requirements</h3><ul>" + "".join(
    f"<li>Requirement number {i} with SQL and Excel experience</li>" for i in range(6)
) + "</ul>"

JSONLD_PAGE = f"""<html><head><script type="application/ld+json">{json.dumps({
    "@context": "https://schema.org", "@type": "JobPosting", "title": "Data Analyst",
    "hiringOrganization": {"@type": "Organization", "name": "Example Corp"}, "description": DESCRIPTION,
})}</script></head><body><nav>Menu</nav><p>Cookie banner</p></body></html>"""


def test_jsonld_job_posting_is_preferred():
    job = extract_job(JSONLD_PAGE, "https://x.example.com")
    assert (job.title, job.company, job.source) == ("Data Analyst", "Example Corp", "jsonld")
    assert "• Requirement number 0 with SQL and Excel experience" in job.text
    assert "Cookie banner" not in job.text


def test_page_text_fallback_strips_navigation_and_scripts():
    body = "".join(f"<li>Build dashboards and reports item {i} for the team</li>" for i in range(10))
    page = f"<html><body><nav>Home Jobs</nav><main><h1>Junior Analyst</h1><ul>{body}</ul></main><script>track()</script><footer>(c)</footer></body></html>"
    job = extract_job(page)
    assert job.source == "page" and job.title == "Junior Analyst"
    assert "Home Jobs" not in job.text and "track()" not in job.text and "(c)" not in job.text


def test_page_without_a_job_description_has_helpful_error():
    with pytest.raises(JobFetchError, match="paste it instead"):
        extract_job("<html><body><div id='app'></div></body></html>")


def test_html_to_text_keeps_structure():
    assert html_to_text("<p>One</p><ul><li>Two</li><li>Three</li></ul>") == "One\n\n• Two\n• Three"


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def test_fetch_follows_safe_redirects_and_extracts():
    def handler(request):
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=JSONLD_PAGE)

    job = fetch_job("https://jobs.example.com/old", client=_client(handler), resolve=public)
    assert job.title == "Data Analyst" and job.url == "https://jobs.example.com/new"


def test_redirect_to_private_address_is_blocked():
    def handler(request):
        return httpx.Response(302, headers={"location": "http://192.168.0.10/secret"})

    with pytest.raises(JobFetchError, match="private or local"):
        fetch_job("https://jobs.example.com/x", client=_client(handler), resolve=public)


@pytest.mark.parametrize("status, message", [(403, "does not allow automated access"), (404, "error 404")])
def test_http_errors_are_explained(status, message):
    with pytest.raises(JobFetchError, match=message):
        fetch_job("https://jobs.example.com/x", client=_client(lambda r: httpx.Response(status)), resolve=public)


def test_non_html_content_is_rejected():
    handler = lambda r: httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF")
    with pytest.raises(JobFetchError, match="not a web page"):
        fetch_job("https://jobs.example.com/x.pdf", client=_client(handler), resolve=public)


def test_oversized_page_is_rejected():
    handler = lambda r: httpx.Response(200, headers={"content-type": "text/html"}, content=b"a" * (3 * 1024 * 1024))
    with pytest.raises(JobFetchError, match="too large"):
        fetch_job("https://jobs.example.com/x", client=_client(handler), resolve=public)
