# WEB corpus attribution and license

## Source

**World English Bible (WEB)** — a modern-English translation of the Bible
released to the **public domain** by its translator, Michael Paul Johnson,
and distributed by ebible.org.

- Canonical source archive: <https://ebible.org/Scriptures/eng-web_usfm.zip>
- Project home: <https://ebible.org/web/>
- Format on disk: USFM 3.0 (Unified Standard Format Markers).

## What is bundled with Prayers Loft

`backend/reading_plans/web_corpus.json` — the WEB text of the 66 canonical
Protestant books, parsed from the USFM release above by
`scripts/import_web_corpus.py`. The file layout is:

```jsonc
{
  "meta": {
    "translation":      "WEB",
    "translation_name": "World English Bible",
    "source":           "https://ebible.org/Scriptures/eng-web_usfm.zip",
    "license":          "Public Domain",
    "imported_at":      "<ISO-8601 UTC timestamp>",
    "book_count":       66,
    "verse_count":      31102
  },
  "books": {
    "GEN": { "1": [ "verse 1 text", "verse 2 text", ... ], "2": [ ... ], ... },
    "EXO": { ... },
    ...
    "REV": { ... }
  }
}
```

Verse arrays are 0-indexed; verse N of chapter C is at
`books[BOOK][str(C)][N - 1]`.

## Known WEB omissions

The following verse-number slots are deliberately empty in WEB because
the corresponding text is absent from the earliest Greek manuscripts and
is documented as such in critical editions. `scripts/test_web_corpus.py`
recognizes these as expected:

- Luke 17:36
- Acts 8:37
- Acts 15:34
- Acts 24:7
- Romans 16:25
- Romans 16:26
- Romans 16:27

## License

The World English Bible is **released into the public domain** by its
translator. No portion of this corpus is subject to copyright and no
attribution is legally required — however, we retain the source URL and
translator credit above as a courtesy to the project.

The importer script, integrity tests, and this notice are covered by the
same license as the rest of the Prayers Loft codebase.

## Reproducing the corpus

Every re-import is byte-deterministic given the same upstream archive:

```bash
python scripts/import_web_corpus.py   # writes backend/reading_plans/web_corpus.json
python scripts/test_web_corpus.py     # 20 spot-checks + structural integrity
```

If ebible.org updates the WEB release (rare, but the WEB is a living
translation) the corpus can be re-imported and the integrity tests
re-run. Any drift from expected spot-check text will surface immediately.
