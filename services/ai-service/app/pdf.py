"""Stage A — PDF → cleaned, layout-aware lines (scope §5 Stage A).

PyMuPDF "dict" extraction gives per-line font cues (size, bold) that the
segmenter needs to tell headings from body. Cleanup done here:
- strip repeating headers/footers: same normalized text in the same page band
  (top/bottom 8%) on >=35% of pages, plus bare page-number lines in the bands
- drop empty/whitespace lines

De-hyphenation happens at line-join time in segment.py, where we know whether
the next line continues the word.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import fitz  # PyMuPDF


@dataclass
class Line:
    text: str
    page: int  # 1-based
    y: float  # top of line, page coords
    size: float  # dominant font size in the line
    bold: bool


_PAGE_NO = re.compile(
    r"^(?:page\s*)?[-–—\s]*\d{1,4}[-–—\s]*(?:of\s+\d{1,4})?$", re.IGNORECASE
)
_BOLD_FLAG = 1 << 4  # fitz span flag bit for bold


def _norm(text: str) -> str:
    """Normalize for repeat detection: collapse ws, mask digits (page counters)."""
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", text.strip().lower()))


def parse_pdf(data: bytes) -> tuple[list[Line], int]:
    """Return (cleaned lines in reading order, page count)."""
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        pages = doc.page_count
        raw: list[Line] = []
        page_h: dict[int, float] = {}
        band_hits: dict[tuple[str, str], set[int]] = {}

        for pno in range(pages):
            page = doc[pno]
            h = page.rect.height
            page_h[pno + 1] = h
            for block in page.get_text("dict")["blocks"]:
                if block.get("type") != 0:  # images
                    continue
                for ln in block["lines"]:
                    spans = [s for s in ln["spans"] if s["text"].strip()]
                    if not spans:
                        continue
                    text = "".join(s["text"] for s in ln["spans"]).strip()
                    if not text:
                        continue
                    line = Line(
                        text=text,
                        page=pno + 1,
                        y=ln["bbox"][1],
                        size=max(s["size"] for s in spans),
                        bold=any(
                            "bold" in s["font"].lower() or (s["flags"] & _BOLD_FLAG)
                            for s in spans
                        ),
                    )
                    raw.append(line)
                    band = _band(line.y, h)
                    if band:
                        band_hits.setdefault((band, _norm(text)), set()).add(line.page)

        min_pages = max(3, int(0.35 * pages))
        repeating = {key for key, seen in band_hits.items() if len(seen) >= min_pages}

        def is_furniture(line: Line) -> bool:
            band = _band(line.y, page_h[line.page])
            if not band:
                return False
            if _PAGE_NO.match(line.text):
                return True
            return (band, _norm(line.text)) in repeating

        return [l for l in raw if not is_furniture(l)], pages
    finally:
        doc.close()


def _band(y: float, page_height: float) -> str:
    if y < 0.08 * page_height:
        return "top"
    if y > 0.92 * page_height:
        return "bot"
    return ""
