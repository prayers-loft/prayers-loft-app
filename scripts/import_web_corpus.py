"""Deterministic WEB corpus importer.

Fetches the World English Bible USFM release from ebible.org, parses it
into a compact book-indexed JSON, and writes it to
backend/reading_plans/web_corpus.json.

Rerun this script any time you want to refresh the corpus. Every run is
byte-deterministic given the same upstream release; the output file
carries a `source` block naming the archive it was built from.

Usage:
    python scripts/import_web_corpus.py

Requires: only the Python standard library. No third-party USFM parser.
The parser is intentionally minimal — it handles just the tags the WEB
distribution actually uses (\\c, \\v, \\p, \\q, and a small set of
footnote/formatting marks that are stripped from verse text).
"""
from __future__ import annotations

import io
import json
import re
import sys
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from reading_plans.bible_structure import BOOK_ORDER, VERSES_PER_CHAPTER  # noqa: E402

SOURCE_URL = "https://ebible.org/Scriptures/eng-web_usfm.zip"
OUTPUT_PATH = ROOT / "backend" / "reading_plans" / "web_corpus.json"

# ebible.org filename pattern: "<order>-<code>eng-web.usfm" where <code>
# almost always matches our USFM code — a few need remapping.
CODE_ALIASES = {
    "PSA": "PSA",   # PSA everywhere
    "SNG": "SNG",   # Song of Songs
    "EZK": "EZK",
    "MRK": "MRK",
    "JHN": "JHN",
    "JOL": "JOL",
    "PHP": "PHP",
    "NAM": "NAM",
    "PHM": "PHM",
    "1SA": "1SA", "2SA": "2SA", "1KI": "1KI", "2KI": "2KI",
    "1CH": "1CH", "2CH": "2CH",
    "1CO": "1CO", "2CO": "2CO",
    "1TH": "1TH", "2TH": "2TH",
    "1TI": "1TI", "2TI": "2TI",
    "1PE": "1PE", "2PE": "2PE",
    "1JN": "1JN", "2JN": "2JN", "3JN": "3JN",
}

# ---------------------------------------------------------------------------
# USFM parsing — bare minimum for the WEB release.
# ---------------------------------------------------------------------------
_TAG_RE = re.compile(r"\\([a-z0-9]+\*?)(\s|$)", re.IGNORECASE)
_VERSE_RE = re.compile(r"^\\v\s+(\d+[a-z]?)(?:-\d+[a-z]?)?\s+(.*)$")
_CHAPTER_RE = re.compile(r"^\\c\s+(\d+)\s*$")

# Inline markers to strip: footnotes \f...\f*, cross-refs \x...\x*,
# character markup like \nd ... \nd*, \wj ... \wj*, \add ... \add*, etc.
# We keep the enclosed text (with markers removed) except for footnotes /
# cross-refs, which we drop entirely.
_DROP_INLINE = re.compile(r"\\(?:f|x)\s.*?\\(?:f|x)\*", re.DOTALL)
_STRIP_MARKUP = re.compile(r"\\[a-z0-9]+\*?\s?")

def clean_verse_text(raw: str) -> str:
    txt = _DROP_INLINE.sub("", raw)
    # \w ... \w* and \+w ... \+w* word markers wrap Strong's-tagged words.
    # Wrap the replacement in spaces so adjacent markers with no source
    # whitespace (e.g. "born\w Son\w*") don't fuse into "bornSon". The
    # trailing punctuation-cleanup below removes any extraneous spaces.
    txt = re.sub(r"\\\+?w\s+([^\\|]*?)(?:\|[^\\]*?)?\\\+?w\*", r" \1 ", txt)
    txt = re.sub(r"\|(?:strong|lemma|x-\w+)=\"[^\"]*\"", "", txt)
    txt = _STRIP_MARKUP.sub("", txt)
    txt = txt.replace("~", " ")
    # Whitespace normalization
    txt = re.sub(r"\s+", " ", txt).strip()
    # Remove space before punctuation, em-dashes, and the possessive
    # apostrophe (U+2019). Preserves opening quotes.
    txt = re.sub(r"\s+([,.;:!?\u2014\u2013])", r"\1", txt)
    txt = re.sub(r"\s+(\u2019(?:s|d|t|re|ve|ll|m)?\b)", r"\1", txt)
    # Insert missing space after sentence punctuation when followed by
    # a letter (repairs "heart,for" -> "heart, for").
    txt = re.sub(r"([,.;:!?])(?=[A-Za-z\u2018\u201c])", r"\1 ", txt)
    # Remove space AFTER opening quotes, em-dashes, and inside contractions
    # ("don' t" -> "don't", "" I" -> "I", "remain— these" -> "remain—these").
    txt = re.sub(r"([\u201c\u2018\u2014\u2013])\s+", r"\1", txt)
    txt = re.sub(r"(\u2019)\s+(s|d|t|re|ve|ll|m)\b", r"\1\2", txt)
    return txt.strip()

def parse_usfm(text: str) -> dict:
    """Return {chapter: {verse: text}} for a single-book USFM file.

    Verse lines can wrap; poetry lines (\\q*) belong to the last-seen
    verse. We collect text into a rolling buffer keyed by (chapter, verse)
    and flush on every new \\v.
    """
    chapters: dict[int, dict[int, str]] = {}
    cur_ch: int | None = None
    cur_v: int | None = None
    buf: list[str] = []

    def flush():
        if cur_ch is None or cur_v is None:
            return
        joined = " ".join(buf).strip()
        if not joined:
            return
        chapters.setdefault(cur_ch, {})[cur_v] = clean_verse_text(joined)

    for raw_line in text.splitlines():
        line = raw_line.strip()
        m_ch = _CHAPTER_RE.match(line)
        if m_ch:
            flush()
            cur_ch = int(m_ch.group(1))
            cur_v = None
            buf = []
            continue
        m_v = _VERSE_RE.match(line)
        if m_v:
            flush()
            # Handle "\\v 12a" style — coerce to integer for our lookup.
            cur_v = int(re.match(r"\d+", m_v.group(1)).group(0))
            buf = [m_v.group(2)]
            continue
        # A continuation line (poetry \\q*, prose \\p, no tag) belonging
        # to the current verse.
        if cur_v is not None and cur_ch is not None:
            # Strip a leading tag if present (e.g. "\q1 text") but keep text.
            stripped = re.sub(r"^\\[a-z0-9]+\*?\s*", "", line)
            if stripped:
                buf.append(stripped)
    flush()
    return chapters

# ---------------------------------------------------------------------------
# Import driver
# ---------------------------------------------------------------------------
def fetch_zip(url: str) -> bytes:
    print(f"[fetch] {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "prayers-loft/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    print(f"[fetch] {len(data):,} bytes")
    return data

def build_book_index(zip_bytes: bytes) -> tuple[dict, dict]:
    """Return (books_dict, meta) — books_dict[USFM_CODE] = chapters dict."""
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    file_map: dict[str, str] = {}
    for name in zf.namelist():
        m = re.match(r"^\d+-(\w+)eng-web\.usfm$", name)
        if not m:
            continue
        code = m.group(1).upper()
        # A few ebible codes need normalization to our BOOK_ORDER
        code = CODE_ALIASES.get(code, code)
        if code in BOOK_ORDER:
            file_map[code] = name

    books: dict[str, dict] = {}
    for code in BOOK_ORDER:
        fname = file_map.get(code)
        if not fname:
            raise RuntimeError(f"WEB import: file for book {code} not found in archive")
        raw = zf.read(fname).decode("utf-8")
        chapters = parse_usfm(raw)
        # Enforce expected chapter count from the canonical structure.
        expected_ch = len(VERSES_PER_CHAPTER[code])
        if max(chapters.keys()) != expected_ch:
            raise RuntimeError(
                f"WEB import: {code} chapter count mismatch — parsed max "
                f"{max(chapters.keys())}, expected {expected_ch}"
            )
        # Flatten to compact structure: chapters as arrays (verse N at
        # position N-1). This is ~40% smaller than dict-of-verses and
        # still human-readable in the JSON blob.
        book_chapters: dict[str, list[str]] = {}
        for ch, verses in chapters.items():
            expected_v = VERSES_PER_CHAPTER[code][ch - 1]
            arr: list[str] = [""] * expected_v
            for v, t in verses.items():
                if 1 <= v <= expected_v:
                    arr[v - 1] = t
            # Flag verses the parser missed — should be zero for WEB.
            missing = [i + 1 for i, s in enumerate(arr) if not s]
            if missing:
                print(f"[warn] {code} {ch}: missing verses {missing}")
            book_chapters[str(ch)] = arr
        books[code] = book_chapters
        print(f"[parse] {code:>4s}  chapters={expected_ch:>3d}  "
              f"verses={sum(len(v) for v in chapters.values())}")

    meta = {
        "translation": "WEB",
        "translation_name": "World English Bible",
        "source": SOURCE_URL,
        "license": "Public Domain",
        "imported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "book_count": len(books),
        "verse_count": sum(len(vs) for b in books.values() for vs in b.values()),
    }
    return books, meta

def main() -> int:
    zip_bytes = fetch_zip(SOURCE_URL)
    books, meta = build_book_index(zip_bytes)
    payload = {"meta": meta, "books": books}
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    size_mb = OUTPUT_PATH.stat().st_size / (1024 * 1024)
    print(f"\n[write] {OUTPUT_PATH}  {size_mb:.2f} MB  verses={meta['verse_count']}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
