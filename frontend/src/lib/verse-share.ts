// -----------------------------------------------------------------------------
// verse-share — pure formatter for the native Share.share() action.
//
// Extracted from scripture.tsx so the copy contract can be unit-tested
// without booting a full React Native environment.
//
// Contract (Build 16 spec):
//   • Include the Scripture reference
//   • Include the verse text (trimmed, quotes normalized)
//   • Optional "Shared from Prayers Loft" attribution footer
//   • Total length capped so it fits comfortably in SMS/Twitter previews
//     (280 chars is a sane ceiling; longer text still works, we just don't
//     truncate the verse — attribution is dropped first)
// -----------------------------------------------------------------------------

export type VerseShareInput = {
  reference: string;
  verse: string;
  /** Include "Shared from Prayers Loft" attribution. Defaults to true. */
  attribution?: boolean;
};

export const ATTRIBUTION = "Shared from Prayers Loft";

/** Return the plain-text share body for a verse.
 *
 *  Format:
 *    "{verse text}"
 *
 *    — {reference}
 *
 *    Shared from Prayers Loft
 *
 *  The trailing attribution line is omitted when `attribution: false` OR
 *  when including it would push the total above the sanity ceiling.
 */
export function formatVerseShareText({
  reference,
  verse,
  attribution = true,
}: VerseShareInput): string {
  const cleanVerse = normalizeQuotes(verse.trim());
  const cleanRef = reference.trim();

  const core = `\u201C${cleanVerse}\u201D\n\n\u2014 ${cleanRef}`;
  if (!attribution) return core;

  const withAttribution = `${core}\n\n${ATTRIBUTION}`;
  // Sanity ceiling: fits into most SMS/tweet previews without wrapping.
  // If exceeding, drop attribution rather than truncate scripture.
  return withAttribution.length <= 280 ? withAttribution : core;
}

/** Normalize straight quotes and stray whitespace so shared text reads
 *  cleanly regardless of source encoding. */
function normalizeQuotes(s: string): string {
  return s
    // collapse runs of whitespace including embedded newlines
    .replace(/\s+/g, " ")
    // strip a leading/trailing straight or curly quote pair some verses
    // arrive with (from bible-api.com WEB text)
    .replace(/^[\u201C"']+|[\u201D"']+$/g, "");
}
