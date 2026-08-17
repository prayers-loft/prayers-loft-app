// Global JS error guard
// ----------------------
// RootErrorBoundary catches errors thrown during React RENDER / lifecycle.
// It CANNOT catch asynchronous errors — an unhandled promise rejection, a
// throw inside a setTimeout / native-module callback / event listener, or an
// error on a RuntimeScheduler task. On a TestFlight/release build those
// otherwise-uncaught errors reach React Native's default global handler,
// which calls RCTFatal → the process SIGABRTs (EXC_CRASH / SIGABRT). In dev
// the same error is shown as a dismissible RedBox, so it looks harmless —
// this is the classic "works in dev, crashes on TestFlight at startup" gap.
//
// This guard installs an ErrorUtils global handler that:
//   • ALWAYS logs + persists the exact error (name/message/stack) so the
//     concrete cause is recoverable on the next launch (Apple .crash files do
//     not carry the JS message).
//   • In DEV: delegates to the previous handler so the RedBox still appears.
//   • In PRODUCTION: does NOT re-invoke the default handler for the error,
//     so a single stray async error cannot abort the whole process. The app
//     stays alive; the user sees a calm toast; we degrade instead of dying.
//
// This mirrors the resilience posture already documented in
// RootErrorBoundary, extended to the async path which was previously
// unprotected.

const LAST_ERROR_KEY = "prayersloft_last_fatal_error_v1";

export type CapturedError = {
  name: string;
  message: string;
  stack: string;
  isFatal: boolean;
  at: string;
};

let installed = false;

async function persistLastError(payload: CapturedError): Promise<void> {
  try {
    const mod = await import("@/src/utils/storage");
    await mod.storage.setItem(LAST_ERROR_KEY, payload);
  } catch {
    // best-effort only — never throw from the guard
  }
}

/** Read (and clear) the last captured fatal error, if any. Used at startup to
 *  surface the concrete message from a prior crashing launch. */
export async function consumeLastCapturedError(): Promise<CapturedError | null> {
  try {
    const mod = await import("@/src/utils/storage");
    const val = (await mod.storage.getItem(LAST_ERROR_KEY, null)) as CapturedError | null;
    if (val) {
      await mod.storage.setItem(LAST_ERROR_KEY, null);
    }
    return val ?? null;
  } catch {
    return null;
  }
}

export function installGlobalErrorGuard(): void {
  if (installed) return;
  installed = true;

  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
      setGlobalHandler?: (h: (error: unknown, isFatal?: boolean) => void) => void;
    };
    __DEV__?: boolean;
  };

  const EU = g.ErrorUtils;
  if (!EU || typeof EU.setGlobalHandler !== "function") return;

  const previous =
    typeof EU.getGlobalHandler === "function" ? EU.getGlobalHandler() : undefined;

  const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : false;

  EU.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    let name = "Error";
    let message = "";
    let stack = "";
    try {
      const e = error as { name?: string; message?: string; stack?: string };
      name = e?.name ?? "Error";
      message = e?.message ?? String(error);
      stack = e?.stack ?? "";
    } catch {
      message = "Unknown error";
    }

    // Always log + persist the concrete message so it is recoverable.
    // eslint-disable-next-line no-console
    console.error(
      `[GlobalErrorGuard] ${isFatal ? "FATAL" : "non-fatal"}: ${name}: ${message}\n${stack}`,
    );
    void persistLastError({
      name,
      message,
      stack,
      isFatal: !!isFatal,
      at: new Date().toISOString(),
    });

    if (isDev) {
      // Keep the RedBox in development so engineers still see every error.
      previous?.(error, isFatal);
      return;
    }

    // Production: keep the process alive. A single uncaught async error —
    // especially during startup — must never SIGABRT the whole app. Surface a
    // calm toast and degrade; the render-level RootErrorBoundary still handles
    // render errors with its own recovery UI.
    try {
      // Lazy import avoids any module-load cycle with the Toast host.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { showToast } = require("@/src/components/Toast");
      showToast?.({
        variant: "error",
        title: "Something went wrong",
        message: "The app hit an unexpected error but is still running.",
        duration: 6000,
      });
    } catch {
      // ignore — never throw from the guard
    }
    // Intentionally do NOT call `previous(error, true)` here: the default RN
    // handler calls RCTFatal, which aborts the process. Swallowing keeps the
    // app alive; the error is already logged + persisted for diagnosis.
  });
}
