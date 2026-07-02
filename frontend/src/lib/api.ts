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

/** Diagnostic helper — used by _layout.tsx to surface a startup toast. */
export function getApiBase(): string {
  return BASE;
}

/** Exposes where the BASE was resolved from — used only by the guarded
 *  startup error log in _layout.tsx (fires when EXPO_PUBLIC_BACKEND_URL
 *  is missing, i.e. a misconfigured build). */
export function getApiBaseSource(): string {
  return BASE_SOURCE;
}

// ---------------------------------------------------------------------------
// Auth refresh interceptor (single-flight)
// ---------------------------------------------------------------------------
// Bug fixed: TestFlight Build 13 users with stale access tokens (token issued
// against a prior backend JWT_SECRET / session lifetime) saw `API 401:
// {"detail":"Invalid token"}` raw in a toast when saving / loading
// reflections. There was no refresh attempt and no guest fallback.
//
// New behavior (per the JWT rotation playbook):
//   1. If a protected request returns 401, attempt ONE refresh via
//      POST /api/auth/refresh using the stored refresh_token.
//   2. On refresh success, persist the new {access, refresh} pair and retry
//      the original request with the new Bearer header.
//   3. On refresh FAILURE we do NOT silently downgrade a previously-signed-in
//      user to guest — that would orphan their next save under a new
//      guest_id and hide their journal (which is scoped by user_id).
//      Instead:
//        - clearAuth() is called (session is dead)
//        - a module-level `sessionExpiredAt` timestamp is set
//        - the current request throws AuthExpiredError (friendly, non-raw)
//        - any *subsequent* request to an owner-scoped endpoint
//          (/reflections, /saved-prayers, /auth/me) throws AuthExpiredError
//          up-front, without hitting the network, until the user signs in
//          again. This closes the observed leak where an initial GET
//          dropped auth and the very next POST silently saved as a guest.
//   4. Concurrent 401s share a single in-flight refresh via the
//      `refreshPromise` lock so we never stampede the rotation endpoint.
//
// Raw API messages ("API 401: ...", "Invalid token", etc.) are mapped to
// friendly errors before being thrown to callers.
let refreshPromise: Promise<string | null> | null = null;
// Timestamp (ms) of the most recent refresh failure that cleared auth. Zero
// when there's no expired-session state to enforce. Reset to zero on any
// successful sign-in via markSessionRestored().
let sessionExpiredAt = 0;

/** Paths that MUST have an authenticated user; guest access on these after
 *  a session expiry would silently orphan data or leak state. When the
 *  session-expired flag is set and no fresh Bearer is available, these paths
 *  fail up-front with AuthExpiredError instead of falling through to guest. */
const OWNER_SCOPED_PATH_PREFIXES = ["/reflections", "/saved-prayers", "/auth/me"];

class AuthExpiredError extends Error {
  readonly isAuthExpired = true;
  constructor(message = "Please sign in again to continue.") {
    super(message);
    this.name = "AuthExpiredError";
  }
}
export { AuthExpiredError };

/** Called by the auth flow (sign-in / register / social) after a fresh
 *  session is established, so subsequent owner-scoped requests are allowed
 *  through the interceptor again. */
export function markSessionRestored(): void {
  sessionExpiredAt = 0;
}

/** Called by other refresh code paths (e.g. `src/lib/auth-client.ts`
 *  authFetch → doRefresh) when they observe a refresh failure and clear
 *  auth. Without this, an initial /api/auth/me probe on /scripture that
 *  fails refresh via auth-client would NOT arm the guard here, and the
 *  user's next Save would silently save under a guest_id. */
export function markSessionExpired(): void {
  sessionExpiredAt = Date.now();
}

function isOwnerScopedPath(path: string): boolean {
  return OWNER_SCOPED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function performRefresh(): Promise<string | null> {
  // Lazy import to keep this module side-effect free and avoid cycles.
  const { getAuthState, patchTokens, clearAuth } = await import("@/src/lib/auth-store");
  const refresh = getAuthState()?.tokens?.refresh_token;
  if (!refresh) {
    // No refresh token to work with — treat as a plain sign-out.
    await clearAuth();
    return null;
  }
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) throw new Error(`refresh status ${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token: string };
    if (!data?.access_token || !data?.refresh_token) {
      throw new Error("refresh returned malformed payload");
    }
    await patchTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    // Successful refresh clears any prior expired-session state.
    sessionExpiredAt = 0;
    return data.access_token;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[api] refresh failed, session marked expired:", e instanceof Error ? e.message : e);
    await clearAuth();
    // Sticky flag: subsequent owner-scoped requests will short-circuit
    // through the interceptor with AuthExpiredError instead of silently
    // becoming guest writes (which would orphan data under a guest_id).
    sessionExpiredAt = Date.now();
    return null;
  }
}

/** Single-flight wrapper so simultaneous 401s share one refresh. */
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
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
  let ownerHeaders = await resolveOwnerHeaders();

  // STICKY EXPIRED-SESSION GUARD.
  // If a previous request in this app session had its refresh fail
  // (performRefresh -> clearAuth -> sessionExpiredAt set), and we don't
  // have a fresh Authorization header now, refuse owner-scoped calls
  // up-front. Without this, an initial GET on /scripture kills the auth
  // via a failed refresh and the very next Save silently writes under a
  // guest_id, orphaning the user's reflection. This guard closes that
  // window until the user signs in again (markSessionRestored() clears).
  if (sessionExpiredAt > 0 && !ownerHeaders["Authorization"] && isOwnerScopedPath(path)) {
    throw new AuthExpiredError(
      "Please sign in to save and view your reflections."
    );
  }

  const buildInit = (oh: Record<string, string>): RequestInit => ({
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...oh,
      ...(init?.headers || {}),
    },
  });

  // Retry-with-exponential-backoff. Preview/dev environments occasionally
  // 404 routes during a wake-up window between when the server starts
  // accepting connections and when FastAPI has registered every router.
  // Real TestFlight users hit this as flaky 404s on /api/prayer-request
  // even though the endpoint exists. We retry on transient failures only.
  // Final 404/500/network error still surfaces to the caller as before.
  const MAX_ATTEMPTS = 3;
  const RETRYABLE_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504]);
  // Tracks whether we've already performed the one-shot 401 → refresh → retry
  // dance for this request. We never loop on auth (would mask a real server
  // error if the refreshed token still gets 401'd, or stampede the refresh
  // endpoint).
  let didAuthRetry = false;
  // Did this request start with a Bearer token? If yes, and refresh fails,
  // we must surface AuthExpiredError so the UI can prompt sign-in — silently
  // downgrading a signed-in user to guest would make their saved reflections
  // vanish (guest_id != user_id) which is worse UX than the 401 leak we're
  // fixing. Pure-guest requests that receive 401 (rare) also still throw
  // the clean error.
  const hadAuthAttempt = !!ownerHeaders["Authorization"];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, buildInit(ownerHeaders));
      if (res.ok) return (await res.json()) as T;

      // One-shot 401 handling: try refresh. If refresh succeeds retry with
      // the new access token. If refresh fails and the request originally
      // had auth, throw AuthExpiredError so the UI prompts sign-in.
      if (res.status === 401 && !didAuthRetry) {
        didAuthRetry = true;
        // eslint-disable-next-line no-console
        console.warn(`[api] 401 on ${url} — attempting token refresh`);
        const newAccess = await refreshAccessToken(); // null if refresh failed
        if (newAccess) {
          // Refresh succeeded — retry with the fresh access token.
          ownerHeaders = await resolveOwnerHeaders();
          attempt -= 1; // don't consume a backoff slot
          continue;
        }
        // Refresh failed. If the caller was authed, this is an expired
        // session — surface it cleanly. clearAuth() has already run inside
        // performRefresh().
        if (hadAuthAttempt) {
          throw new AuthExpiredError(
            "Please sign in to save and view your reflections."
          );
        }
        // Pure guest that got 401 — very rare. Fall through to the normal
        // error path below (still yields a clean AuthExpiredError since we
        // don't loop retries on auth failures).
      }

      const bodyText = await res.text().catch(() => "");
      const shouldRetry = RETRYABLE_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS;
      // eslint-disable-next-line no-console
      console.warn(
        `[api] ${init?.method || "GET"} ${url} → ${res.status} ` +
          `(attempt ${attempt}/${MAX_ATTEMPTS}, base=${BASE}). ` +
          `Body: ${bodyText.slice(0, 200)}${bodyText.length > 200 ? "…" : ""}`
      );
      if (!shouldRetry) {
        // Translate 401 to a clean, user-facing error. Raw 'API 401:
        // {"detail":"Invalid token"}' must NEVER reach a toast.
        if (res.status === 401) {
          throw new AuthExpiredError(
            "Please sign in to save and view your reflections."
          );
        }
        throw new Error(`API ${res.status}: ${bodyText || res.statusText}`);
      }
    } catch (err: any) {
      lastErr = err;
      const isFinal = attempt >= MAX_ATTEMPTS;
      // Distinguish "thrown by us above" (Error with API status prefix)
      // from network-layer errors (TypeError: Network request failed).
      const isOurThrow =
        err instanceof Error && (/^API \d+:/.test(err.message) || (err as any).isAuthExpired);
      if (isOurThrow && isFinal) throw err;
      if (isOurThrow && err instanceof AuthExpiredError) throw err; // never retry auth errors
      // eslint-disable-next-line no-console
      console.warn(
        `[api] ${init?.method || "GET"} ${url} threw on attempt ` +
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
    return request<{
      verse: string;
      reference: string;
      verse_id: string;
      bible_link: string;
      devotional: string;
      // New structured payload. Null when the backend could not parse the LLM
      // response into the expected 5-section shape, or when this is the fast
      // verse-only fetch. Frontend falls back to plain-text devotional in
      // either case.
      devotional_structured: {
        title: string;
        key_scripture: string;
        reflection: string;
        application: string;
        prayer: string;
      } | null;
      local_date: string;
    }>(
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
    request<{
      response: string;
      // Populated only for mode=devotional. Null when the LLM returns a non
      // JSON answer (graceful degradation to the legacy plain text card).
      response_structured: {
        title: string;
        key_scripture: string;
        reflection: string;
        application: string;
        prayer: string;
      } | null;
      mode: string;
    }>("/bible-assistant", {
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
