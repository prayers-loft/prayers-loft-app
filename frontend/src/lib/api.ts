// Backend API client for Prayers Loft.
//
// IMPORTANT: BASE URL resolution must work in 3 environments:
//   1. Web/dev: `process.env.EXPO_PUBLIC_BACKEND_URL` is inlined by Metro.
//   2. iOS/Android release builds: `process.env` is sometimes stripped/empty
//      → fall back to `Constants.expoConfig.extra.EXPO_PUBLIC_BACKEND_URL`,
//      which is baked from app.json `extra` at build time.
//   3. Older Expo SDK manifests: `Constants.manifest.extra` as a final fallback.
//
// Without this fallback chain, iOS TestFlight builds end up with BASE="undefined"
// and every fetch silently 404s — the exact bug in v1.0.0 build 5.
import Constants from "expo-constants";

function resolveBase(): { base: string; source: "process.env" | "Constants.expoConfig.extra" | "Constants.manifest.extra" | "(none)" } {
  const fromProcess = typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_BACKEND_URL : undefined;
  if (fromProcess) return { base: fromProcess.replace(/\/$/, ""), source: "process.env" };
  const fromExpoConfig = (Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL;
  if (fromExpoConfig) return { base: String(fromExpoConfig).replace(/\/$/, ""), source: "Constants.expoConfig.extra" };
  const fromManifest = (Constants?.manifest as any)?.extra?.EXPO_PUBLIC_BACKEND_URL;
  if (fromManifest) return { base: String(fromManifest).replace(/\/$/, ""), source: "Constants.manifest.extra" };
  return { base: "", source: "(none)" };
}

const { base: BASE, source: BASE_SOURCE } = resolveBase();

// ── BUILD_VERIFICATION_TEMP — added for Build 11 verification ────────────────
// Prints the resolved BASE URL and where it came from to the JS console at
// module load. This appears in:
//   • Metro logs (web/dev)
//   • Xcode Console.app device log (iOS TestFlight) — search for "[api]"
//   • Android adb logcat (Android internal builds)
// Remove after Build 11 verification is complete (grep BUILD_VERIFICATION_TEMP).
// eslint-disable-next-line no-console
console.log(`[api] BUILD_VERIFICATION_TEMP — BASE="${BASE}" (source=${BASE_SOURCE})`);
// ─────────────────────────────────────────────────────────────────────────────

/** Diagnostic helper — used by _layout.tsx to surface a startup toast. */
export function getApiBase(): string {
  return BASE;
}

/** BUILD_VERIFICATION_TEMP — exposes where the BASE was resolved from. Remove after Build 11. */
export function getApiBaseSource(): string {
  return BASE_SOURCE;
}

// Lazy reads of the auth state and the stable guest_id. We avoid top-level
// imports to keep this module side-effect-free and to dodge import cycles
// (auth-store and guest-identity both reach into storage on first call).
async function resolveOwnerHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  // Authenticated user token, if any.
  try {
    const { getAuthState } = await import("@/src/lib/auth-store");
    const access = getAuthState()?.tokens?.access_token;
    if (access) headers["Authorization"] = `Bearer ${access}`;
  } catch {
    // auth-store unavailable; fall through and try guest_id
  }
  // Anonymous guest id (always present after first launch).
  try {
    const { getGuestId } = await import("@/src/lib/guest-identity");
    const gid = await getGuestId();
    if (gid) headers["X-Guest-Id"] = gid;
  } catch {
    // guest-identity unavailable on this platform; not fatal — caller may still
    // succeed if it's a public endpoint (e.g. /api/daily-verse).
  }
  return headers;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE) {
    // Make this loud and visible — silent fetch failures are how we got here.
    throw new Error("API base URL is not configured (EXPO_PUBLIC_BACKEND_URL missing).");
  }
  const url = `${BASE}/api${path}`;
  // Auto-attach ownership headers (Bearer token if signed in, X-Guest-Id
  // otherwise) so backend endpoints that scope by owner (/api/reflections
  // and friends) never see a "no owner" request. The patch in
  // backend/server.py for the v1.0 P0 cross-user leak requires this.
  // Caller-supplied headers win on conflict.
  const ownerHeaders = await resolveOwnerHeaders();
  const mergedInit: RequestInit = {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...ownerHeaders,
      ...(init?.headers || {}),
    },
  };

  // Retry-with-exponential-backoff. Preview/dev environments occasionally
  // 404 routes during a wake-up window between when the server starts
  // accepting connections and when FastAPI has registered every router.
  // Real TestFlight users hit this as flaky 404s on /api/prayer-request
  // even though the endpoint exists. We retry on transient failures only.
  // Final 404/500/network error still surfaces to the caller as before.
  const MAX_ATTEMPTS = 3;
  const RETRYABLE_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504]);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, mergedInit);
      if (res.ok) return (await res.json()) as T;
      const bodyText = await res.text().catch(() => "");
      const shouldRetry = RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS;
      // eslint-disable-next-line no-console
      console.warn(
        `[api] ${mergedInit.method || "GET"} ${url} → ${res.status} ` +
          `(attempt ${attempt}/${MAX_ATTEMPTS}, base=${BASE}). ` +
          `Body: ${bodyText.slice(0, 200)}${bodyText.length > 200 ? "…" : ""}`
      );
      if (!shouldRetry) {
        throw new Error(`API ${res.status}: ${bodyText || res.statusText}`);
      }
    } catch (err: any) {
      lastErr = err;
      const isFinal = attempt >= MAX_ATTEMPTS;
      // Distinguish "thrown by us above" (Error with API status prefix)
      // from network-layer errors (TypeError: Network request failed).
      const isOurThrow = err instanceof Error && /^API \d+:/.test(err.message);
      if (isOurThrow && isFinal) throw err;
      // eslint-disable-next-line no-console
      console.warn(
        `[api] ${mergedInit.method || "GET"} ${url} threw on attempt ` +
          `${attempt}/${MAX_ATTEMPTS} (base=${BASE}): ${err?.message || err}`
      );
      if (isFinal) throw err;
    }
    // Exponential backoff with jitter: 400ms, 1200ms (then return on attempt 3).
    const baseDelay = 400 * Math.pow(3, attempt - 1);
    const jitter = Math.floor(Math.random() * 200);
    await new Promise((r) => setTimeout(r, baseDelay + jitter));
  }
  // Defensive — unreachable, retry loop always returns or throws above.
  throw (lastErr instanceof Error ? lastErr : new Error("API request failed"));
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

  dailyVerse: (localDate?: string, tz?: string, includeDevotional: boolean = true) => {
    const params = new URLSearchParams();
    if (localDate) params.set("local_date", localDate);
    if (tz) params.set("tz", tz);
    if (!includeDevotional) params.set("include_devotional", "false");
    const qs = params.toString();
    return request<{ verse: string; reference: string; verse_id: string; bible_link: string; devotional: string; local_date: string }>(
      `/daily-verse${qs ? `?${qs}` : ""}`
    );
  },

  reactToVerse: (verse_id: string, reaction: string) =>
    request<{ verse_id: string; reaction: string; count: number }>("/react-to-verse", {
      method: "POST",
      body: JSON.stringify({ verse_id, reaction }),
    }),

  getReactionCounts: (verse_id: string) =>
    request<{ verse_id: string; counts: Record<string, number> }>(`/get-reaction-counts?verse_id=${encodeURIComponent(verse_id)}`),

  bibleAssistant: (mode: "question" | "devotional", input: string) =>
    request<{ response: string; mode: string }>("/bible-assistant", {
      method: "POST",
      body: JSON.stringify({ mode, input }),
    }),
  theologicalQuestion: (question: string, verse: string, style: "Devotional" | "Theologian") =>
    request<{ response: string; style: string }>("/theological-question", {
      method: "POST",
      body: JSON.stringify({ question, verse, style }),
    }),

  shareExcerpt: (text: string, style: "Devotional" | "Theologian" | "Prayer" | "Verse", question?: string) =>
    request<{ excerpt: string; cached?: boolean; fallback?: boolean }>("/share-excerpt", {
      method: "POST",
      body: JSON.stringify({ text, style, question }),
    }),

  listReflections: () =>
    request<{ reflections: { id: string; text: string; emotion?: string; prompt?: string; verse_id?: string; created_at: string; updated_at: string }[] }>("/reflections"),

  createReflection: (text: string, emotion?: string, prompt?: string, verse_id?: string) =>
    request<{ id: string; text: string; emotion?: string; prompt?: string; verse_id?: string; created_at: string; updated_at: string }>("/reflections", {
      method: "POST",
      body: JSON.stringify({ text, emotion, prompt, verse_id }),
    }),

  updateReflection: (id: string, text: string, emotion?: string) =>
    request<{ id: string; text: string; emotion?: string; updated_at: string }>(`/reflections/${id}`, {
      method: "PUT",
      body: JSON.stringify({ text, emotion }),
    }),

  deleteReflection: (id: string) =>
    request<{ deleted: boolean; id: string }>(`/reflections/${id}`, { method: "DELETE" }),
};
