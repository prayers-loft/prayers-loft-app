// Backend API client for Prayers Loft.
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${txt || res.statusText}`);
  }
  return (await res.json()) as T;
}

export type PrayerReflection = {
  empathy: string;
  characterReflection: string;
  verseText: string;
  verseReference: string;
  bibleLink: string;
  closingQuestion: string;
  raw: string;
};

const BOOK_MAP: Record<string, string> = {
  genesis: "GEN", exodus: "EXO", leviticus: "LEV", numbers: "NUM", deuteronomy: "DEU",
  joshua: "JOS", judges: "JDG", ruth: "RUT", "1 samuel": "1SA", "2 samuel": "2SA",
  "1 kings": "1KI", "2 kings": "2KI", "1 chronicles": "1CH", "2 chronicles": "2CH",
  ezra: "EZR", nehemiah: "NEH", esther: "EST", job: "JOB", psalm: "PSA", psalms: "PSA",
  proverbs: "PRO", ecclesiastes: "ECC", "song of solomon": "SNG", "song of songs": "SNG",
  isaiah: "ISA", jeremiah: "JER", lamentations: "LAM", ezekiel: "EZK", daniel: "DAN",
  hosea: "HOS", joel: "JOL", amos: "AMO", obadiah: "OBA", jonah: "JON", micah: "MIC",
  nahum: "NAM", habakkuk: "HAB", zephaniah: "ZEP", haggai: "HAG", zechariah: "ZEC", malachi: "MAL",
  matthew: "MAT", mark: "MRK", luke: "LUK", john: "JHN", acts: "ACT", romans: "ROM",
  "1 corinthians": "1CO", "2 corinthians": "2CO", galatians: "GAL", ephesians: "EPH",
  philippians: "PHP", colossians: "COL", "1 thessalonians": "1TH", "2 thessalonians": "2TH",
  "1 timothy": "1TI", "2 timothy": "2TI", titus: "TIT", philemon: "PHM", hebrews: "HEB",
  james: "JAS", "1 peter": "1PE", "2 peter": "2PE", "1 john": "1JN", "2 john": "2JN",
  "3 john": "3JN", jude: "JUD", revelation: "REV",
};

export function buildBibleLink(reference: string): string {
  // ref like "Philippians 4:6-7" or "Psalm 23:1"
  const m = reference.trim().match(/^((?:\d\s)?[A-Za-z ]+?)\s+(\d+):(\d+)/);
  if (!m) return "https://www.bible.com/";
  const book = m[1].trim().toLowerCase();
  const chapter = m[2];
  const verse = m[3];
  const code = BOOK_MAP[book] || book.slice(0, 3).toUpperCase();
  return `https://www.bible.com/bible/1/${code}.${chapter}.${verse}`;
}

export function parsePrayerReflection(raw: string): PrayerReflection {
  // Split lines and look for the VERSE: line
  const lines = raw.split(/\r?\n/);
  let verseLine = "";
  let verseLineIdx = -1;
  let questionLine = "";
  let questionLineIdx = -1;

  lines.forEach((l, i) => {
    if (verseLineIdx === -1 && /^VERSE:/i.test(l.trim())) {
      verseLine = l.trim();
      verseLineIdx = i;
    }
    if (/would you like me to pray with you/i.test(l)) {
      questionLine = l.trim();
      questionLineIdx = i;
    }
  });

  let verseText = "";
  let verseReference = "";
  if (verseLine) {
    // Accept either: VERSE: "text" (Reference)   or   VERSE: "text" — Reference
    let vm = verseLine.match(/^VERSE:\s*"?(.+?)"?\s*\(([^)]+)\)\s*$/i);
    if (!vm) {
      vm = verseLine.match(/^VERSE:\s*"?(.+?)"?\s*[—–-]\s*(.+)$/i);
    }
    if (vm) {
      verseText = vm[1].trim().replace(/^"|"$/g, "");
      verseReference = vm[2].trim();
    }
  }

  // empathy + character reflection = everything before verse line
  const beforeVerse = verseLineIdx >= 0 ? lines.slice(0, verseLineIdx).join("\n").trim() : raw.trim();
  // Split first paragraph as empathy, rest as character reflection
  const paragraphs = beforeVerse.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const empathy = paragraphs[0] || "";
  const characterReflection = paragraphs.slice(1).join("\n\n");

  return {
    empathy,
    characterReflection,
    verseText,
    verseReference,
    bibleLink: verseReference ? buildBibleLink(verseReference) : "",
    closingQuestion: questionLine || "Would you like me to pray with you about this?",
    raw,
  };
}

// API methods
export const api = {
  prayerRequest: (message: string) =>
    request<{ response: string }>("/prayer-request", { method: "POST", body: JSON.stringify({ message }) }),

  prayerFollowUp: (message: string) =>
    request<{ prayer: string }>("/prayer-follow-up", {
      method: "POST",
      body: JSON.stringify({ message, consent: true }),
    }),

  dailyVerse: () =>
    request<{ verse: string; reference: string; verse_id: string; bible_link: string; devotional: string }>("/daily-verse"),

  reactToVerse: (verse_id: string, reaction: string) =>
    request<{ verse_id: string; reaction: string; count: number }>("/react-to-verse", {
      method: "POST",
      body: JSON.stringify({ verse_id, reaction }),
    }),

  getReactionCounts: (verse_id: string) =>
    request<{ verse_id: string; counts: Record<string, number> }>(`/get-reaction-counts?verse_id=${encodeURIComponent(verse_id)}`),

  theologicalQuestion: (question: string, verse: string, style: "Devotional" | "Theologian") =>
    request<{ response: string; style: string }>("/theological-question", {
      method: "POST",
      body: JSON.stringify({ question, verse, style }),
    }),

  listReflections: () =>
    request<{ reflections: { id: string; text: string; emotion?: string; prompt?: string; created_at: string; updated_at: string }[] }>("/reflections"),

  createReflection: (text: string, emotion?: string, prompt?: string) =>
    request<{ id: string; text: string; emotion?: string; prompt?: string; created_at: string; updated_at: string }>("/reflections", {
      method: "POST",
      body: JSON.stringify({ text, emotion, prompt }),
    }),

  updateReflection: (id: string, text: string, emotion?: string) =>
    request<{ id: string; text: string; emotion?: string; updated_at: string }>(`/reflections/${id}`, {
      method: "PUT",
      body: JSON.stringify({ text, emotion }),
    }),

  deleteReflection: (id: string) =>
    request<{ deleted: boolean; id: string }>(`/reflections/${id}`, { method: "DELETE" }),
};
