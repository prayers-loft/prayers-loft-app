// Emergent-managed Google Auth client. Web-friendly: redirects to the Emergent
// hosted auth page, lands back at our origin with `?session_id=...` (or hash),
// then exchanges the session id for our own tokens via /api/auth/google.
// On native, uses WebBrowser.openAuthSessionAsync.
import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { exchangeGoogleSession } from "@/src/lib/auth-api";
import { AuthUser } from "@/src/lib/auth-store";

const EMERGENT_AUTH_HOST = "https://auth.emergentagent.com/";

function extractSessionId(url: string): string | null {
  try {
    const hashIdx = url.indexOf("#");
    const fragment = hashIdx >= 0 ? url.slice(hashIdx + 1) : "";
    if (fragment) {
      const sp = new URLSearchParams(fragment);
      const sid = sp.get("session_id");
      if (sid) return sid;
    }
    const qIdx = url.indexOf("?");
    if (qIdx >= 0) {
      const sp = new URLSearchParams(url.slice(qIdx + 1));
      const sid = sp.get("session_id");
      if (sid) return sid;
    }
  } catch {}
  return null;
}

function redirectUrl(): string {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") return window.location.origin + "/";
    return "/";
  }
  return Linking.createURL("auth");
}

export async function startGoogleSignIn(): Promise<AuthUser | null> {
  const redirect = redirectUrl();
  const authUrl = `${EMERGENT_AUTH_HOST}?redirect=${encodeURIComponent(redirect)}`;

  if (Platform.OS === "web") {
    if (typeof window !== "undefined") {
      window.location.href = authUrl;
    }
    return null; // page will reload; user is captured by handleGoogleReturnFromUrl on remount
  }

  const result = await WebBrowser.openAuthSessionAsync(authUrl, redirect);
  if (result.type !== "success" || !result.url) return null;
  const sid = extractSessionId(result.url);
  if (!sid) return null;
  return await exchangeGoogleSession(sid);
}

export async function handleGoogleReturnFromUrl(): Promise<AuthUser | null> {
  // Web cold-start / post-redirect path: detect ?session_id= or #session_id= and exchange.
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined") return null;
  const sid = extractSessionId(window.location.href);
  if (!sid) return null;
  try {
    const user = await exchangeGoogleSession(sid);
    // Clean up URL so refresh doesn't re-exchange.
    try {
      window.history.replaceState(null, "", window.location.pathname);
    } catch {}
    return user;
  } catch {
    return null;
  }
}
