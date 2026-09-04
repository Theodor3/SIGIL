import hashlib
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup

from .store import now

ALLOWED_HOSTS = {
    "www.sec.gov", "sec.gov", "data.sec.gov",
    "arxiv.org", "export.arxiv.org",
    "proceedings.mlr.press", "fred.stlouisfed.org",
    "www.federalreserve.gov", "www.bls.gov", "www.bea.gov",
}
MAX_BYTES = 400_000


def validate_url(url, *, resolve=True):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Sources must be ordinary public HTTPS pages.")
    if parsed.hostname not in ALLOWED_HOSTS:
        raise ValueError("This source is outside the pilot's approved public research domains.")
    if resolve:
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise ValueError("The source did not resolve to a public address.")
    return url


def fetch_source(url):
    """Read a small public source. No cookies, proxy credentials, or private URLs."""
    validate_url(url)
    with httpx.Client(timeout=12, follow_redirects=False, trust_env=False,
                      headers={"User-Agent": "SIGIL-Research-Pilot/0.1", "Accept": "text/html,text/plain,application/json"}) as client:
        for _ in range(4):
            with client.stream("GET", url) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers.get("location", ""))
                    validate_url(url)
                    continue
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").lower()
                if not any(t in content_type for t in ("text/html", "text/plain", "application/json")):
                    raise ValueError("Only HTML, text and JSON sources can be read in this pilot.")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_BYTES:
                        raise ValueError("The source exceeds the pilot's download limit.")
                text = raw.decode("utf-8", errors="replace")
                title = urlsplit(url).hostname
                if "html" in content_type:
                    soup = BeautifulSoup(text, "html.parser")
                    title = soup.title.get_text(" ", strip=True)[:200] if soup.title else title
                    for element in soup(["script", "style", "nav", "footer", "header"]):
                        element.decompose()
                    text = soup.get_text(" ", strip=True)
                return dict(url=url, title=title, text=text[:7000], fetched_at=now(),
                            sha256=hashlib.sha256(raw).hexdigest(), status="retrieved",
                            note="Page retrieved; individual claims still require review.")
    raise ValueError("The source redirected too many times.")
