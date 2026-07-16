// -----------------------------------------------------------------------------
// walk-api — client for the /api/walk/* discipleship-companion endpoints.
//
// Streaming: React Native does not have a reliable Response.body.getReader()
// across platforms, so we use XMLHttpRequest with progressive `responseText`
// and parse Server-Sent Events out of the accumulated buffer.
//
// Owner scoping (matches api.ts pattern): attach Bearer if signed in AND
// X-Guest-Id always (backend prefers Bearer when both are present).
// -----------------------------------------------------------------------------
import { apiUrl } from "@/src/lib/auth-client";
import { getGuestId } from "@/src/lib/guest-identity";

async function _ownerHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = {};
  try {
    const { getAuthState } = await import("@/src/lib/auth-store");
    const access = getAuthState()?.tokens?.access_token;
    if (access) h["Authorization"] = `Bearer ${access}`;
  } catch {}
  try {
    const gid = await getGuestId();
    if (gid) h["X-Guest-Id"] = gid;
  } catch {}
  return h;
}

async function _walkFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = apiUrl(path);
  const owner = await _ownerHeaders();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...owner,
    ...((init.headers as Record<string, string>) || {}),
  };
  return fetch(url, { ...init, headers });
}

// ---------- Types (mirror backend Pydantic) ----------
export type MemoryKind = "prayer" | "struggle" | "lesson" | "commitment";
export type MemoryStatus = "active" | "resolved" | "revisit";
export type ConfirmationSource =
  | "explicit_user_action"
  | "explicit_statement"
  | "unconfirmed";

export type MemoryItem = {
  id: string;
  kind: MemoryKind;
  content: string;
  scripture_ref: string | null;
  status: MemoryStatus;
  confirmation_source: ConfirmationSource;
  source_session_id: string | null;
  source_message_ids: string[];
  created_at: string;
  updated_at: string;
  last_referenced_at: string | null;
  user_id?: string;
  guest_id?: string;
  outcome?: string;
};

export type WalkMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type WalkSession = {
  id: string;
  user_id?: string;
  guest_id?: string;
  started_at: string;
  ended_at: string | null;
  messages: WalkMessage[];
  session_summary: string | null;
};

export type SessionStartResponse = {
  id: string;
  opening_message: string;
  memory_context_count: number;
  is_first_session: boolean;
};

export type MemoryCandidate = {
  kind: MemoryKind;
  content: string;
  scripture_ref: string | null;
  confidence: number;
  confirmation_source: ConfirmationSource;
  source_message_indices: number[];
};

export type SessionEndResponse = {
  id: string;
  ended_at: string;
  candidates_saved: MemoryItem[];
  candidates_pending: MemoryCandidate[];
};

export async function getWalkLanding(): Promise<{
  is_first_ever: boolean;
  session_count: number;
  last_session_summary: string | null;
  callback_hint: string | null;
  active_commitment: string | null;
  active_struggle: string | null;
  active_prayer: string | null;
}> {
  const res = await _walkFetch("/api/walk/landing", { method: "GET" });
  if (!res.ok) throw new Error(`landing_failed:${res.status}`);
  return res.json();
}

// ---------- Non-streaming endpoints ----------
export async function startWalkSession(): Promise<SessionStartResponse> {
  const res = await _walkFetch("/api/walk/session/start", { method: "POST" });
  if (!res.ok) throw new Error(`start_failed:${res.status}`);
  return res.json();
}

export async function getWalkSession(sessionId: string): Promise<WalkSession> {
  const res = await _walkFetch(`/api/walk/session/${sessionId}`, { method: "GET" });
  if (!res.ok) throw new Error(`get_session_failed:${res.status}`);
  return res.json();
}

export async function endWalkSession(
  sessionId: string,
): Promise<SessionEndResponse> {
  const res = await _walkFetch(`/api/walk/session/${sessionId}/end`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`end_failed:${res.status}`);
  return res.json();
}

export async function listMemory(params?: {
  kind?: MemoryKind;
  status?: MemoryStatus;
}): Promise<{ items: MemoryItem[] }> {
  const qs = new URLSearchParams();
  if (params?.kind) qs.set("kind", params.kind);
  if (params?.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs}` : "";
  const res = await _walkFetch(`/api/walk/memory${suffix}`, { method: "GET" });
  if (!res.ok) throw new Error(`list_memory_failed:${res.status}`);
  return res.json();
}

export async function createMemory(payload: {
  kind: MemoryKind;
  content: string;
  scripture_ref?: string | null;
  confirmation_source?: "explicit_user_action" | "explicit_statement";
  source_session_id?: string | null;
}): Promise<MemoryItem> {
  const res = await _walkFetch("/api/walk/memory", {
    method: "POST",
    body: JSON.stringify({
      confirmation_source: "explicit_user_action",
      ...payload,
    }),
  });
  if (!res.ok) throw new Error(`create_memory_failed:${res.status}`);
  return res.json();
}

export async function updateMemory(
  memoryId: string,
  payload: { content?: string; status?: MemoryStatus; scripture_ref?: string },
): Promise<MemoryItem> {
  const res = await _walkFetch(`/api/walk/memory/${memoryId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`update_memory_failed:${res.status}`);
  return res.json();
}

export async function deleteMemory(memoryId: string): Promise<void> {
  const res = await _walkFetch(`/api/walk/memory/${memoryId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete_memory_failed:${res.status}`);
}

export async function createCommitment(payload: {
  content: string;
  scripture_ref?: string | null;
  source_session_id?: string | null;
}): Promise<MemoryItem> {
  const res = await _walkFetch("/api/walk/commitment", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`create_commitment_failed:${res.status}`);
  return res.json();
}

export async function updateCommitment(
  memoryId: string,
  status: "kept" | "still_trying" | "did_not" | "resolved" | "active",
): Promise<MemoryItem> {
  const res = await _walkFetch(`/api/walk/commitment/${memoryId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`update_commitment_failed:${res.status}`);
  return res.json();
}

// ---------- Streaming: XHR-based SSE parser ----------
export type StreamHandlers = {
  onChunk: (text: string) => void;
  onDone?: (messageId?: string) => void;
  onError?: (err: Error) => void;
};

/** Sends a user message and streams the assistant reply.
 *
 * Returns an abort function. Consumers should call it in cleanup so a
 * screen unmount cancels an in-flight completion.
 */
export function streamWalkMessage(
  sessionId: string,
  text: string,
  handlers: StreamHandlers,
): () => void {
  const xhr = new XMLHttpRequest();
  const url = apiUrl(`/api/walk/session/${sessionId}/message`);

  let aborted = false;
  let lastIndex = 0;
  let doneFired = false;

  const parseFrames = (buf: string) => {
    let idx = buf.indexOf("\n\n", lastIndex);
    while (idx !== -1) {
      const frame = buf.slice(lastIndex, idx);
      lastIndex = idx + 2;
      const lines = frame.split("\n");
      let eventName = "message";
      const dataLines: string[] = [];
      for (const l of lines) {
        if (l.startsWith("event:")) {
          eventName = l.slice(6).trim();
        } else if (l.startsWith("data:")) {
          dataLines.push(l.slice(5).replace(/^ /, ""));
        }
      }
      const data = dataLines.join("\n");
      if (eventName === "done") {
        try {
          const parsed = data ? JSON.parse(data) : {};
          handlers.onDone?.(parsed?.message_id);
        } catch {
          handlers.onDone?.();
        }
        doneFired = true;
      } else if (eventName === "error") {
        handlers.onError?.(new Error(data || "stream_error"));
      } else if (data) {
        const rehydrated = data.replace(/\\n/g, "\n");
        handlers.onChunk(rehydrated);
      }
      idx = buf.indexOf("\n\n", lastIndex);
    }
  };

  xhr.onreadystatechange = () => {
    if (xhr.readyState >= 3 && !aborted) {
      parseFrames(xhr.responseText || "");
    }
    if (xhr.readyState === 4 && !aborted) {
      const tail = (xhr.responseText || "").slice(lastIndex);
      if (tail.trim()) parseFrames((xhr.responseText || "") + "\n\n");
      if (!doneFired) {
        if (xhr.status >= 200 && xhr.status < 300) {
          handlers.onDone?.();
        } else {
          handlers.onError?.(new Error(`stream_http_${xhr.status || "network"}`));
        }
      }
    }
  };
  xhr.onerror = () => {
    if (!aborted) handlers.onError?.(new Error("stream_network_error"));
  };

  // Open + attach owner headers asynchronously (guest id lookup is async).
  (async () => {
    const owner = await _ownerHeaders();
    if (aborted) return;
    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    for (const [k, v] of Object.entries(owner)) {
      try {
        xhr.setRequestHeader(k, v);
      } catch {}
    }
    try {
      xhr.send(JSON.stringify({ text }));
    } catch (e) {
      handlers.onError?.(e as Error);
    }
  })();

  return () => {
    aborted = true;
    try {
      xhr.abort();
    } catch {}
  };
}
