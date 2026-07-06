// -----------------------------------------------------------------------------
// guest-soft-banner-visibility — pure predicate for the "Save your spiritual
// journey" nudge on the Prayer home screen.
//
// WHY THIS FILE EXISTS (separate from GuestSoftBanner.tsx)
// --------------------------------------------------------
// The predicate lives here — free of any React / react-native imports —
// so tests/tests/unit-guest-soft-banner.spec.ts can import it directly
// from Node under ts-node without trying to load the native runtime.
// The GuestSoftBanner component simply re-exports it and uses it.
//
// See the header on GuestSoftBanner.tsx for the visibility contract.
// -----------------------------------------------------------------------------

/** 14 days in ms. After this window from the last dismiss, the banner
 *  becomes eligible to appear again. Kept as a const so tests can pin
 *  the exact boundary. */
export const GUEST_SOFT_BANNER_SUPPRESS_MS = 14 * 24 * 60 * 60 * 1000;

/** Pure predicate — decides whether the banner should render given the
 *  three inputs. Kept pure (no storage, no React) so it can be unit-
 *  tested exhaustively.
 *
 *  Invariants (Build 16 fix):
 *    • authReady === false  → return false (no flash during restore)
 *    • signedIn  === true   → return false (no upsell for signed-in
 *                             users — this is the exact bug fixed)
 *    • otherwise             → dismiss-window arithmetic decides
 *
 *  @param authReady      state.ready from auth-store
 *  @param signedIn       true when state.user != null
 *  @param dismissedAtIso ISO string from storage; empty string means
 *                        "never dismissed". Corrupt values fail OPEN
 *                        (banner shown) so a bad write never buries
 *                        the upsell forever.
 *  @param now            Injectable clock — deterministic tests. */
export function shouldRenderGuestSoftBanner(
  authReady: boolean,
  signedIn: boolean,
  dismissedAtIso: string,
  now: number = Date.now(),
): boolean {
  if (!authReady) return false;
  if (signedIn) return false;
  if (!dismissedAtIso) return true;
  const at = new Date(dismissedAtIso).getTime();
  if (!Number.isFinite(at)) return true;
  return now - at > GUEST_SOFT_BANNER_SUPPRESS_MS;
}
