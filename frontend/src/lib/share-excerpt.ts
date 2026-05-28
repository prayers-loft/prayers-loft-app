// Hybrid share-excerpt utilities.
// Short responses are excerpted instantly client-side; long/complex ones
// fall through to the backend Claude-powered excerpt endpoint.
// All results are memoised in-process so repeated share attempts on the same
// response are free after the first generation.
import { api } from "./api";

const MAX_EXCERPT_CHARS = 280; // ~ shareable on Twitter, looks great on cards
const CLIENT_THRESHOLD_CHARS = 260; // below this we trust simple client truncation

const memo = new Map<string, string>();

function hashKey(text: string, style: string) {
  // Simple FNV-ish hash. Good enough for in-memory cache keys.
  let h = 2166136261;
  const s = `${style}::${text}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `${style}:${h.toString(36)}`;
}

function splitSentences(text: string): string[] {
  // Split on sentence boundaries while preserving punctuation.
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[\.\?!])\s+(?=[A-Z\"\u201c\u2018])/g)
    .filter(Boolean);
}

/** Pick the most resonant 1-2 sentences from a short response (client-side, instant). */
function clientExcerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= MAX_EXCERPT_CHARS) return clean;

  const sentences = splitSentences(clean);
  if (sentences.length === 0) return clean.slice(0, MAX_EXCERPT_CHARS - 3).trim() + "...";

  // Greedy pick: accumulate sentences until we approach the char limit.
  let out = "";
  for (const s of sentences) {
    if (!out) {
      out = s;
      continue;
    }
    if ((out.length + 1 + s.length) <= MAX_EXCERPT_CHARS) {
      out = `${out} ${s}`;
    } else {
      break;
    }
  }
  if (!out) {
    out = sentences[0].slice(0, MAX_EXCERPT_CHARS - 3).trim() + "...";
  }
  return out;
}

export async function getShareExcerpt(
  text: string,
  style: "Devotional" | "Theologian" | "Prayer" | "Verse",
  opts: { question?: string } = {}
): Promise<string> {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const key = hashKey(cleaned, style);
  const cached = memo.get(key);
  if (cached) return cached;

  // Short response → client-side instant excerpt (no API call).
  if (cleaned.length <= CLIENT_THRESHOLD_CHARS) {
    const out = clientExcerpt(cleaned);
    memo.set(key, out);
    return out;
  }

  // Long response → ask Claude (server-cached too).
  try {
    const r = await api.shareExcerpt(cleaned, style, opts.question);
    const out = (r.excerpt || clientExcerpt(cleaned)).trim();
    memo.set(key, out);
    return out;
  } catch (e) {
    console.warn("share excerpt API failed, using client fallback", e);
    const out = clientExcerpt(cleaned);
    memo.set(key, out);
    return out;
  }
}

export function clearExcerptMemo() {
  memo.clear();
}
