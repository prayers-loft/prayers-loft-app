# Canonical Scripture Journey — Authoring Rules

**Purpose.** These rules are the standard every one of the ~1,000 reading days
in `canonical-web-v1.json` must satisfy. They exist so a reader on day 500
gets the same care and coherence as a reader on day 5, and so any future
editor (human or agent) can revise the plan without drifting from the
original intent.

Any entry that cannot honor these rules gets flagged in the validation
report and reviewed manually before ship.

---

## 1. Passage boundary rules

### 1.1 One coherent unit per day
Every reading is a **single literary or theological unit** — a completed
thought, not a fragment of one. Practical guidance:
- A narrative episode ends when the scene ends (the actors leave, time
  advances, or the narrator explicitly transitions).
- A poem, psalm, parable, or vision is preserved whole even if long.
- A Pauline / apostolic argument runs from its opening claim to its
  concluding statement (usually a "therefore" or a doxology).
- A prophetic oracle runs from its introductory formula
  ("The word of Yahweh came to X") through its closing formula.

### 1.2 Do not split what Scripture itself binds together
The following are **never split** across days, even when longer than the
soft length target:
- A single psalm.
- A single parable.
- A single vision or oracle.
- A genealogy that leads directly into a narrative event (keep them together).
- A miracle account plus its immediate interpretation by Jesus / the
  narrator.
- A New Testament argument that hinges on a single "for this reason /
  therefore" pivot.
- A covenant scene (giving of the covenant + response).

### 1.3 When to split
Split within a chapter only when the chapter itself contains two clearly
distinct units. Common licit splits:
- Sermon on the Mount — Beatitudes vs. antitheses vs. instructions on
  giving vs. instructions on prayer, etc.
- Long OT law codes where distinct case-laws stand independently
  (Exodus 21–23, Leviticus 11–15).
- Extended prophetic collections where each oracle carries its own
  introductory formula (Isaiah 13–23 oracles against the nations).

### 1.4 When to combine
Combine across chapter boundaries when the chapter divisions were
imposed later and cut a unit in half. Known joints to keep together:
- Genesis 1:26–2:3 (creation of humanity through the seventh-day rest)
- Genesis 32:22–33:20 (Jacob wrestles + reunion with Esau)
- Isaiah 52:13–53:12 (fourth Servant Song)
- Malachi 3–4 (single closing exhortation in most manuscript traditions)
- Matthew 8–9 miracle cycle sections
- John 7:53–8:11 as its own contained account
- Acts 21–22 arrest + defense before the crowd
- Romans 9–11 (do not slice mid-argument; may span 3–4 days but transitions land at 9:33, 10:21, 11:12)

### 1.5 Length envelope
| Metric | Soft target | Hard limit |
|---|---:|---:|
| Verses per day (median) | 20–30 | — |
| Verses per day (upper) | 35 | 60, and only for a unit that must not be split (e.g. Psalm 119 sections, Isaiah 40) |
| Verses per day (lower) | 8 | 3, and only for dense self-contained units (Obadiah, doxologies, Philemon splits) |
| Reading time at ~4 verses/min | 5–8 min | 12 min max |

If a candidate boundary exceeds the hard limit, first try to find a
smaller natural break; only override if the unit is truly indivisible.

---

## 2. Key Verse rules

### 2.1 Central-theme rule, not first-verse rule
The Key Verse is the verse a mature reader would quote from the passage
if asked "what is this reading about?" It is **not**:
- automatically the first verse of the passage,
- automatically the most-quoted verse in Christian culture,
- automatically the "punchline" verse if the punchline sits outside the
  passage's actual message.

Examples of correct central-theme selections:
- Genesis 1:1–25 → **1:1** (creation ex nihilo *is* the theme — first
  verse and central theme happen to align).
- Genesis 1:26–2:3 → **1:27** (not 1:26; image of God is the payload).
- Genesis 15:1–21 → **15:6** (not 15:1; faith-reckoned-righteousness is
  the theological center Paul later cites).
- John 15:1–17 → **15:5** (not 15:1 nor 15:13; "apart from me you can
  do nothing" carries the whole vine metaphor).

### 2.2 One verse or a tight 2–3 verse span
Prefer a single verse. A 2–3 verse span is allowed when the theme is
articulated across a single sentence Scripture itself preserves as one
breath (e.g. Genesis 12:2–3, Ephesians 2:8–9, Philippians 4:6–7).

Never span more than 3 verses in a Key Verse.

### 2.3 Key Verse must live inside the passage
The Key Verse's `book`, `chapter`, and `verse_num` must fall within one
of the day's `passages` ranges. The validator enforces this.

### 2.4 Reference formatting
The `reference` string uses the human book name and a hyphen-separated
verse range for multi-verse selections:
- `"Genesis 1:1"`
- `"Genesis 12:2-3"` (not `1:2 through 1:3`)
- `"Psalm 91:1-2"` (books that use "Psalm" — never "Psalms" — for
  single-psalm citations)

---

## 3. Passage summary rules

### 3.1 Descriptive, not interpretive
The summary reports **what happens in the passage** and, when relevant,
**what Scripture itself claims about it**. It does not:
- moralize ("this teaches us that…"),
- add extrabiblical background ("as Jewish tradition holds…"),
- draw application ("we should…"),
- speculate about characters' unstated motives.

The summary is scaffolding for the LLM devotional generator; the
generator does the application layer. If the summary itself preaches,
the devotional will double-preach.

### 3.2 Length envelope
- 1 sentence for short/simple passages
- 2 sentences for narrative or complex arguments
- No summary exceeds 60 words
- No summary is fewer than 8 words

### 3.3 Neutrality across theological traditions
Summaries stay descriptive enough to serve Reformed, Wesleyan, Catholic,
and evangelical-generic readers alike. Where a passage is famously
disputed (predestination texts, sacramental texts, eschatological
imagery), the summary states what the text says without landing on a
tradition-specific interpretation.

### 3.4 Voice
Third-person, present tense, warm-but-restrained.
- ✅ "Jesus warns against praying for show and gives his disciples a
  pattern to follow."
- ❌ "Have you ever prayed just to look holy? Jesus challenges that
  today…" (this is a devotional, not a summary)

### 3.5 Names and formatting
- Use "God" and "Jesus" as-is.
- When WEB uses `Yahweh`, the summary uses `the Lord` (summaries are the
  connective tissue, not the sacred text — this keeps the tone
  approachable).
- Numbers spelled as digits ("12 disciples", not "twelve disciples").
- No markdown; no bullet points; no em-dashes as a habit (0–1 max).

---

## 4. Book distribution rules

The full plan is ~1,000 days. Allocation is not proportional to page
count — Wisdom / poetry books get more per-chapter density (a psalm a
day) while long narrative books (Chronicles) get proportionally fewer.

| Section | Days (target) | Notes |
|---|---:|---|
| Pentateuch | 155 | Genesis 40 · Exodus 32 · Leviticus 22 · Numbers 32 · Deuteronomy 29 |
| Historical Books | 145 | Joshua 18 · Judges 16 · Ruth 3 · 1–2 Samuel 40 · 1–2 Kings 35 · 1–2 Chronicles 24 · Ezra 6 · Nehemiah 8 · Esther 5 |
| Wisdom / Poetry | 200 | Job 22 · Psalms 120 (avg 1.25/day) · Proverbs 27 · Ecclesiastes 8 · Song 5 |
| Major Prophets | 128 | Isaiah 48 · Jeremiah 40 · Lamentations 5 · Ezekiel 30 · Daniel 12 |
| Minor Prophets | 52 | roughly a chapter per day, with the very short books getting their own day |
| Gospels | 145 | Matthew 40 · Mark 30 · Luke 40 · John 35 |
| Acts | 25 | narrative sections |
| Epistles | 120 | Paul 90 · General 30 |
| Revelation | 22 | 1 chapter per day (some short chapters combined) |
| **Total target** | **992** | rounded up to ~1,000 with adjustment room |

Distribution is intentionally slightly under 1,000 to leave room for
splits that end up needing an extra day (an oracle that turns out to be
two units, a psalm that pairs with the next).

---

## 5. Ordering

Canonical Protestant order, front to back — Genesis to Revelation. No
interleaving, no chronological reordering. That's what a future
"Chronological Journey" plan is for.

---

## 6. Duplication and coverage

- Every verse in the Protestant canon must be covered exactly once.
- No verse may appear in two different days unless the entry carries
  `intentional_repeat: true` with a `note` explaining why.
- Reserved for very rare cases; the current design assumes **zero
  intentional repeats** in `canonical-web-v1.json`.

---

## 7. WEB text fidelity

- Key Verse text is drawn verbatim from the bundled World English Bible
  corpus. Zero paraphrase, zero substitution.
- WEB uses `Yahweh` where the Hebrew Tetragrammaton appears. This is
  preserved in `key_verse.text`. (Summaries render it as `the Lord`.)
- Punctuation and capitalization match WEB exactly.

---

## 8. When a day cannot honor these rules

Some passages will resist clean application of the rules — long
genealogies, apocalyptic sections with overlapping visions, prose that
straddles a chapter break unusually. When a day requires a judgment
call, the entry gets:

```json
"editorial_note": "Split at 15:21 rather than end-of-chapter because …"
```

The validator surfaces every `editorial_note` in the anomalies section
of the coverage report so a human reviewer can spot-check them before
ship.

---

## 9. Immutability

Once `canonical-web-v1.json` is shipped and users begin their journey,
the entry order and content of each day is frozen. Improvements ship
as `canonical-web-v2.json` or a new plan id. Users on v1 continue on v1
unless they explicitly switch — protecting the promise "resume exactly
where you left off."

---

## Applied — spot-checking the review sample against these rules

| Day | Passage | Rule tested | Verdict |
|---:|---|---|---|
| 1 | Gen 1:1–25 | 1.1 coherent unit (days 1–5 of creation) | ✅ |
| 2 | Gen 1:26–2:3 | 1.4 combine across chapter to keep unit whole | ✅ |
| 6 | Gen 5:1–6:8 | 1.4 genealogy binds to Noah narrative | ✅ |
| 4 | Gen 3:1–24 | 2.1 Key Verse 3:15 not first verse | ✅ |
| 12 | Gen 15:1–21 | 2.1 Key Verse 15:6 is theological center | ✅ |
| — | Psalm 51 | 1.2 psalm preserved whole | ✅ |
| — | John 15:1–17 | 2.1 Key Verse 15:5 (not 15:1) | ✅ |
| — | 1 Cor 13:1–13 | 1.2 chapter preserved whole | ✅ |
| — | Rom 12:1–21 | 1.5 length 21 verses inside envelope | ✅ |
| — | Eph 2:1–10 | 3.1 summary describes, does not exhort | ✅ |

All 39 sample entries pass all applicable rules under this framework.
