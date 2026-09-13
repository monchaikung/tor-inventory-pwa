from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import urljoin

PRICE_RE = re.compile(r"£\s*(\d{1,3}(?:,\d{3})+|\d+)")
MILEAGE_RE = re.compile(r"([\d,]+)\s*miles", re.IGNORECASE)
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
POSTCODE_RE = re.compile(
    r"\b([A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2})\b",
    re.IGNORECASE,
)


def parse_price(text: str) -> int | None:
    match = PRICE_RE.search(text.replace("\xa0", " "))
    if not match:
        return None
    return int(match.group(1).replace(",", ""))


def parse_mileage(text: str) -> int | None:
    match = MILEAGE_RE.search(text.replace("\xa0", " "))
    if not match:
        return None
    return int(match.group(1).replace(",", ""))


def parse_year(text: str) -> int | None:
    match = YEAR_RE.search(text)
    return int(match.group(0)) if match else None


def parse_postcode(text: str) -> str | None:
    match = POSTCODE_RE.search(text)
    return match.group(1).upper() if match else None


def split_title(title: str) -> tuple[str, str, str | None]:
    cleaned = re.sub(r"\s+", " ", title).strip()
    cleaned = re.sub(r"^(19|20)\d{2}\s+", "", cleaned)
    parts = cleaned.split(" ")
    if len(parts) < 2:
        return cleaned, "", None
    make, model = parts[0], parts[1]
    trim = " ".join(parts[2:]) or None
    return make, model, trim


def abs_url(base: str, href: str | None) -> str | None:
    if not href:
        return None
    return urljoin(base, href)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip = False
        if tag in {"p", "div", "li", "h1", "h2", "h3", "h4", "tr", "br"}:
            self._chunks.append("\n")
        elif tag in {"span", "a"}:
            self._chunks.append(" ")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self._chunks.append(data)

    def text(self) -> str:
        return re.sub(r"[ \t]+", " ", "".join(self._chunks))


def html_to_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html)
    return parser.text()
