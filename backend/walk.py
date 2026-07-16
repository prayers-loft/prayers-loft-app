"""
Walk — the discipleship companion module.

Owns:
- Conversation sessions (durable log of chat turns per user/guest).
- A curated memory ledger (prayer / struggle / lesson / commitment) that
  is written to ONLY on explicit user confirmation (never on model inference).
- Streaming Claude Sonnet 4.5 replies via SSE, with a careful system prompt
  that treats the AI as a companion — never a pastor, prophet, or therapist.

Design principles (from spec):
- Memory is user-owned. Nothing durable is stored without an explicit
  confirmation signal (source = "explicit_user_action" | "explicit_statement").
- Scripture is optional per reply. When present, the reference is stored
  separately from the quotation so the UI can render them distinctly.
- Commitments are optional per session. A session in which the user only
  reflected is a complete session.
- Crisis language interrupts the ordinary flow (see SYSTEM_PROMPT).
- Doctrinal disputes are not blanket-refused — see SYSTEM_PROMPT.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, Field

from emergentintegrations.llm.chat import (
    LlmChat,
    UserMessage,
    get_integration_proxy_url,
)
import litellm

logger = logging.getLogger("walk")

# -----------------------------------------------------------------------------
# Model + key
# -----------------------------------------------------------------------------
WALK_PROVIDER = "anthropic"
WALK_MODEL = "claude-sonnet-4-5-20250929"

_EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


# =============================================================================
# System prompt — the voice of the companion
# =============================================================================
SYSTEM_PROMPT = """You walk alongside someone in their journey of following Jesus. You are a companion, not a pastor, prophet, therapist, spiritual director, or replacement for church community or professional care. If asked or the situation warrants, name that boundary gently and without shame.

Your voice is unhurried, warm, and honest — like a wise friend who has walked a while with the Lord. You listen more than you speak. You do not preach, moralize, or perform enthusiasm. You do not open with "certainly!" or "great question!" You do not use emojis unless the person uses one first and reflecting it feels natural.

===
LISTENING BEFORE INTERPRETING
Before offering substantial interpretation, correction, or a proposed act of obedience, first demonstrate you understood — briefly reflect what you heard, and ask a clarifying question when the person's meaning, context, emotional state, or desired kind of help is unclear. For simple or explicit questions ("what does John 3:16 mean?"), you may respond directly.

===
NAMING THE THREE VOICES
Three kinds of speech may appear in your replies. You do NOT need all three every time — use only what fits.
1. Reflecting the person → begin with "You said..." (a short paraphrase of what they told you).
2. Scripture → begin with "Scripture says..." followed by a short verbatim ESV excerpt and the reference (e.g. Philippians 4:6-7). Add a brief note on the surrounding meaning so it is used in context, not as a proof-text.
3. Your own thinking → begin with "I'm wondering..." or "It sounds like..." — always tentative, always offered for their consideration. Never with the authority of Scripture.

Never blur these. Never present your inference as if it were Scripture. If you do not have Scripture to offer, do not force one.

===
SCRIPTURE DISCIPLINE
- Use ESV. Only quote a verse if you are confident of the verbatim wording. If unsure, describe the passage and give the reference rather than fabricating a quotation.
- Include enough surrounding context (usually a short sentence about what the passage is about) so it is not proof-texted.
- Silence is allowed. Not every reply needs a verse.
- Do not chain-quote multiple verses in one reply unless the person asks.

===
COMMITMENTS ARE OPTIONAL
When — and only when — the person wants practical help, or a concrete faithful next step naturally follows from what they said, you may gently propose ONE small, specific, honest act. Not "pray more" — but "text your sister and say sorry." Not "read the Bible" — but "read Philippians 4 tomorrow morning with your coffee." Only after the person voluntarily says yes to something like that does it become a commitment. Do not push. A session in which the person felt heard and prayed is a complete session.

===
MEMORY POLICY
You may be shown a short ledger of things this person previously shared — prayers, struggles, lessons, or commitments. Treat it as context, not a script. Do not read it back like a report. Do not surface stale items unless they feel truly relevant.

===
BOUNDARIES AND SAFEGUARDS

CRISIS (self-harm, suicidal thoughts, abuse, imminent danger): stop the ordinary flow immediately. Acknowledge briefly and honestly. Name that what they are describing is important. Encourage the person to reach out right now to someone they trust nearby AND to call local emergency services or a crisis line. If the person appears to be in the United States or Canada, you may mention 988 (Suicide & Crisis Lifeline). Otherwise recommend contacting local emergency services or a local crisis line — do NOT hard-code a US/Canada number for an international user. Do not offer Scripture, propose commitments, or engage in theological discussion until immediate safety is addressed. Ask if they can reach a person right now.

DOCTRINAL DIFFERENCES: faithful Christian traditions differ. When asked about matters where the Church has historically disagreed (e.g. predestination and free will, spiritual gifts, baptism, end times, women in ministry, communion, sanctification), briefly and fairly summarize the major interpretations Christians hold; do not declare one tradition unquestionably right; and encourage the person to talk with a trusted pastor or mature believer within their own church tradition. You may share your own uncertainty. You may not claim the final word.

DIVINE REVELATION: never say "God told me to tell you...", never claim personal revelation, never position yourself as a spiritual authority. If pressed, name that gently.

PROFESSIONAL CARE: you are not a therapist or doctor. When someone is describing what sounds like clinical depression, trauma, addiction, or a medical concern, encourage them to seek professional help alongside the spiritual work.

===
FORMAT NOTES
- Prefer short paragraphs and gentle pacing. White space is a virtue.
- End sessions with a brief blessing or affirmation, not a task list.
"""


# =============================================================================
# Extraction prompt — session-end, strict JSON output.
# =============================================================================
EXTRACTION_PROMPT = """You are a memory extractor for a discipleship companion. You are shown a completed conversation between a person and their companion. Your ONLY job is to identify durable memory candidates the person may want to keep — nothing else.

Return a JSON object with exactly this shape:

{
  "candidates": [
    {
      "kind": "prayer" | "struggle" | "lesson" | "commitment",
      "content": "1-2 sentence paraphrase in the person's voice (\\"I...\\" or \\"I'm...\\")",
      "scripture_ref": "book chapter:verse ESV" | null,
      "confidence": 0.0-1.0,
      "confirmation_source": "explicit_statement" | "unconfirmed",
      "source_message_indices": [0-based indices of user messages that support this]
    }
  ]
}

Rules:
- Return at most 5 candidates. Fewer is fine — often 0 or 1 is right.
- "confirmation_source" is "explicit_statement" ONLY when the person clearly stated the item themselves (e.g. "I'm struggling with anxiety about work", "I commit to calling my mom this week", "I'm going to read Philippians 4 tomorrow", "I'm praying for my sister's healing"). Assistant statements or your own inferences are always "unconfirmed".
- Never invent content the person did not say.
- Never store small talk, greetings, or generic reflections.
- Never store PII beyond first name.
- "kind" mapping:
    prayer     — a specific prayer the person is offering or asking for
    struggle   — a difficulty the person is actively wrestling with
    lesson     — a spiritual insight the person articulated
    commitment — a specific act the person said they will do

Return ONLY the JSON object. No preamble. No trailing commentary.
"""


# =============================================================================
# Pydantic models
# =============================================================================
KindLiteral = Literal["prayer", "struggle", "lesson", "commitment"]
StatusLiteral = Literal["active", "resolved", "revisit"]
ConfirmationSourceLiteral = Literal[
    "explicit_user_action", "explicit_statement", "unconfirmed"
]


class SessionStartResponse(BaseModel):
    id: str
    opening_message: str
    memory_context_count: int
    is_first_session: bool


class UserMessageRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class MemoryCandidate(BaseModel):
    kind: KindLiteral
    content: str
    scripture_ref: Optional[str] = None
    confidence: float = 0.0
    confirmation_source: ConfirmationSourceLiteral = "unconfirmed"
    source_message_indices: List[int] = Field(default_factory=list)


class SessionEndResponse(BaseModel):
    id: str
    ended_at: str
    candidates_saved: List[Dict[str, Any]]
    candidates_pending: List[MemoryCandidate]


class MemoryCreate(BaseModel):
    kind: KindLiteral
    content: str = Field(..., min_length=1, max_length=1000)
    scripture_ref: Optional[str] = Field(default=None, max_length=200)
    # For MVP the client always passes explicit_user_action when the user
    # taps "Save this" on a suggested candidate, or explicit_statement when
    # persisting a candidate the extractor already marked explicit.
    confirmation_source: Literal["explicit_user_action", "explicit_statement"] = (
        "explicit_user_action"
    )
    source_session_id: Optional[str] = None
    source_message_ids: List[str] = Field(default_factory=list)


class MemoryUpdate(BaseModel):
    content: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    status: Optional[StatusLiteral] = None
    scripture_ref: Optional[str] = Field(default=None, max_length=200)


class CommitmentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=500)
    scripture_ref: Optional[str] = Field(default=None, max_length=200)
    source_session_id: Optional[str] = None


class CommitmentUpdate(BaseModel):
    status: Literal["kept", "still_trying", "did_not", "resolved", "active"]


# =============================================================================
# Persistence helpers
# =============================================================================
def _owner_filter(owner: dict) -> dict:
    if "user_id" in owner:
        return {"user_id": owner["user_id"]}
    return {"guest_id": owner["guest_id"]}


def _owner_fields(owner: dict) -> dict:
    return _owner_filter(owner)


async def ensure_walk_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create indexes; safe to call repeatedly."""
    try:
        await db.walk_sessions.create_index([("owner_key", 1), ("started_at", -1)])
        await db.walk_sessions.create_index("id", unique=True)
        await db.walk_memory.create_index(
            [("owner_key", 1), ("status", 1), ("updated_at", -1)]
        )
        await db.walk_memory.create_index("id", unique=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("ensure_walk_indexes non-fatal: %s", e)


def _owner_key(owner: dict) -> str:
    """Single-string owner key for compound-index efficiency."""
    if "user_id" in owner:
        return f"u:{owner['user_id']}"
    return f"g:{owner['guest_id']}"


# =============================================================================
# Opening question logic
# =============================================================================
FIRST_SESSION_OPENER = (
    "Hi — I'm glad you're here. Take your time.\n\n"
    "What has been weighing on you, or shaping your walk with God, lately?"
)

RETURNING_NO_MEMORY_OPENER = "Welcome back. How has your walk with God been lately?"


def _returning_opener_with_memory(memory: List[dict]) -> str:
    """Pick a natural callback from active memory. Prefer commitments, then
    active struggles, then active prayers. We quote the memory verbatim
    (in the person's own voice) rather than attempt verb-conjugation
    tricks — safer and more honest."""
    # Priority: an unresolved commitment first — that's the follow-up promise.
    commitments = [
        m for m in memory if m["kind"] == "commitment" and m["status"] == "active"
    ]
    if commitments:
        c = commitments[0]
        return (
            "Welcome back. Last time you said, "
            f"\u201c{c['content'].strip().rstrip('.')}.\u201d "
            "How has that been?"
        )
    struggles = [
        m for m in memory if m["kind"] == "struggle" and m["status"] == "active"
    ]
    if struggles:
        s = struggles[0]
        return (
            "Welcome back. Last time you shared, "
            f"\u201c{s['content'].strip().rstrip('.')}.\u201d "
            "How is that today?"
        )
    prayers = [m for m in memory if m["kind"] == "prayer" and m["status"] == "active"]
    if prayers:
        p = prayers[0]
        return (
            "Welcome back. You were praying: "
            f"\u201c{p['content'].strip().rstrip('.')}.\u201d "
            "Anything you'd want to share?"
        )
    return RETURNING_NO_MEMORY_OPENER


# =============================================================================
# Memory context serialization for the model
# =============================================================================
def _format_memory_for_context(memory: List[dict]) -> str:
    """Produce a compact, natural-language ledger for the model. Never a list
    of raw JSON — Claude follows tone better when context reads as prose."""
    if not memory:
        return "No prior memory yet."
    lines: List[str] = []
    for m in memory[:15]:
        kind = m["kind"]
        content = m["content"].strip().rstrip(".")
        ref = f" (they mentioned {m['scripture_ref']})" if m.get("scripture_ref") else ""
        lines.append(f"- {kind}: {content}{ref}")
    return "The person previously shared these things (context only — do not read back like a report):\n" + "\n".join(
        lines
    )


def _build_session_system_message(memory: List[dict]) -> str:
    ledger = _format_memory_for_context(memory)
    return SYSTEM_PROMPT + "\n\n===\nCONTEXT LEDGER\n" + ledger


# =============================================================================
# Router factory
# =============================================================================
def build_walk_router(
    get_db_fn: Callable[[], AsyncIOMotorDatabase],
    get_owner_dep: Callable,
) -> APIRouter:
    """Construct the /walk router.

    Args:
        get_db_fn: zero-arg callable returning the current AsyncIOMotorDatabase.
        get_owner_dep: FastAPI dependency callable that resolves the caller
                       to either {"user_id": ...} or {"guest_id": ...}.
    """
    router = APIRouter(prefix="/walk", tags=["walk"])

    # --------------------------- Session start ---------------------------
    @router.post("/session/start", response_model=SessionStartResponse)
    async def start_session(owner: dict = Depends(get_owner_dep)):
        db = get_db_fn()
        # Load active memory to decide the opening line and to seed context.
        active_memory = (
            await db.walk_memory.find(
                {"owner_key": _owner_key(owner), "status": "active"},
                {"_id": 0},
            )
            .sort("updated_at", -1)
            .to_list(length=15)
        )
        # Determine first-vs-returning by any prior session.
        prior_count = await db.walk_sessions.count_documents(
            {"owner_key": _owner_key(owner)}
        )
        is_first = prior_count == 0
        if is_first:
            opener = FIRST_SESSION_OPENER
        elif active_memory:
            opener = _returning_opener_with_memory(active_memory)
        else:
            opener = RETURNING_NO_MEMORY_OPENER

        sid = str(uuid.uuid4())
        session_doc = {
            "id": sid,
            "owner_key": _owner_key(owner),
            **_owner_fields(owner),
            "started_at": _now_iso(),
            "ended_at": None,
            # Persist the opener as the first assistant message so the client
            # can render it and history stays honest.
            "messages": [
                {
                    "id": str(uuid.uuid4()),
                    "role": "assistant",
                    "content": opener,
                    "at": _now_iso(),
                }
            ],
            "session_summary": None,
        }
        await db.walk_sessions.insert_one(session_doc)
        return SessionStartResponse(
            id=sid,
            opening_message=opener,
            memory_context_count=len(active_memory),
            is_first_session=is_first,
        )

    # --------------------------- Send message (SSE) ---------------------------
    @router.post("/session/{session_id}/message")
    async def send_message(
        session_id: str,
        payload: UserMessageRequest,
        owner: dict = Depends(get_owner_dep),
    ):
        db = get_db_fn()
        session = await db.walk_sessions.find_one(
            {"id": session_id, "owner_key": _owner_key(owner)}, {"_id": 0}
        )
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if session.get("ended_at"):
            raise HTTPException(status_code=409, detail="Session already ended")

        # Persist the user turn immediately so if the stream is dropped
        # server-side we still have an honest record.
        user_msg = {
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": payload.text,
            "at": _now_iso(),
        }
        await db.walk_sessions.update_one(
            {"id": session_id, "owner_key": _owner_key(owner)},
            {"$push": {"messages": user_msg}},
        )

        # Load memory NOW so the stream reflects the latest ledger.
        active_memory = (
            await db.walk_memory.find(
                {"owner_key": _owner_key(owner), "status": "active"},
                {"_id": 0},
            )
            .sort("updated_at", -1)
            .to_list(length=15)
        )
        system_msg = _build_session_system_message(active_memory)

        # Reload full session (including the user turn we just persisted) so
        # LlmChat receives real history (not just the current turn). We
        # replay by sending prior turns as a single condensed history block
        # inside the system message. This keeps token cost predictable and
        # matches the emergentintegrations single-turn contract cleanly.
        fresh = await db.walk_sessions.find_one(
            {"id": session_id, "owner_key": _owner_key(owner)}, {"_id": 0}
        )
        transcript = _condense_transcript(fresh.get("messages", []))
        combined_system = system_msg + "\n\n===\nCONVERSATION SO FAR\n" + transcript

        assistant_msg_id = str(uuid.uuid4())
        assistant_at = _now_iso()

        async def _event_gen():
            """Server-Sent Events stream: 'data: <chunk>\\n\\n' frames.
            Emits 'event: done\\n' at the end. Persists the final assistant
            message to the session doc on stream completion.

            We stream via litellm directly (not LlmChat.send_message) because
            the installed emergentintegrations build does not expose a
            streaming API. We reuse the same emergent proxy config so
            billing / model routing behaves identically.
            """
            accumulated: List[str] = []
            try:
                # Build litellm params matching emergentintegrations proxy setup.
                params: Dict[str, Any] = {
                    "model": WALK_MODEL,
                    "messages": [
                        {"role": "system", "content": combined_system},
                        {"role": "user", "content": payload.text},
                    ],
                    "api_key": _EMERGENT_LLM_KEY,
                    "stream": True,
                    "temperature": 0.75,
                    "max_tokens": 800,
                }
                if _EMERGENT_LLM_KEY.startswith("sk-emergent-"):
                    proxy_url = get_integration_proxy_url()
                    params["api_base"] = proxy_url + "/llm"
                    params["custom_llm_provider"] = "openai"

                response = await litellm.acompletion(**params)
                async for chunk in response:
                    try:
                        delta = chunk.choices[0].delta.content
                    except Exception:  # noqa: BLE001
                        delta = None
                    if not delta:
                        continue
                    accumulated.append(delta)
                    # SSE frame — escape embedded newlines so the client can rehydrate.
                    safe = delta.replace("\r", "").replace("\n", "\\n")
                    yield f"data: {safe}\n\n"
            except Exception as e:  # noqa: BLE001
                logger.exception("Walk stream failure: %s", e)
                yield 'event: error\ndata: {"detail":"stream_failed"}\n\n'
            finally:
                # Persist whatever we got — partial reply is better than
                # nothing so a follow-up "how did it end?" is possible.
                final_text = "".join(accumulated).strip()
                if final_text:
                    try:
                        await db.walk_sessions.update_one(
                            {"id": session_id, "owner_key": _owner_key(owner)},
                            {
                                "$push": {
                                    "messages": {
                                        "id": assistant_msg_id,
                                        "role": "assistant",
                                        "content": final_text,
                                        "at": assistant_at,
                                    }
                                }
                            },
                        )
                    except Exception:  # noqa: BLE001
                        logger.exception("Failed to persist assistant reply")
                yield f'event: done\ndata: {{"message_id":"{assistant_msg_id}"}}\n\n'

        return StreamingResponse(
            _event_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    # --------------------------- Session end ---------------------------
    @router.post("/session/{session_id}/end", response_model=SessionEndResponse)
    async def end_session(
        session_id: str, owner: dict = Depends(get_owner_dep)
    ):
        db = get_db_fn()
        session = await db.walk_sessions.find_one(
            {"id": session_id, "owner_key": _owner_key(owner)}, {"_id": 0}
        )
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        if session.get("ended_at"):
            # Idempotent close — return what we already have.
            return SessionEndResponse(
                id=session_id,
                ended_at=session["ended_at"],
                candidates_saved=[],
                candidates_pending=[],
            )

        ended_at = _now_iso()
        await db.walk_sessions.update_one(
            {"id": session_id, "owner_key": _owner_key(owner)},
            {"$set": {"ended_at": ended_at}},
        )

        # Extraction — best effort. Errors do not fail the close.
        candidates: List[MemoryCandidate] = []
        try:
            candidates = await _extract_candidates(session.get("messages", []))
        except Exception as e:  # noqa: BLE001
            logger.exception("extraction failed (non-fatal): %s", e)

        # Auto-save rule: extraction can only produce explicit_statement or
        # unconfirmed. We save explicit_statement candidates automatically
        # BECAUSE the user's own words are the source; the user retains
        # DELETE control. Unconfirmed candidates are returned as pending —
        # the client surfaces them for tap-to-save.
        saved: List[Dict[str, Any]] = []
        pending: List[MemoryCandidate] = []
        for c in candidates:
            if c.confirmation_source == "explicit_statement" and c.confidence >= 0.6:
                doc = await _save_memory(
                    db,
                    owner,
                    MemoryCreate(
                        kind=c.kind,
                        content=c.content,
                        scripture_ref=c.scripture_ref,
                        confirmation_source="explicit_statement",
                        source_session_id=session_id,
                    ),
                )
                saved.append(doc)
            else:
                pending.append(c)

        return SessionEndResponse(
            id=session_id,
            ended_at=ended_at,
            candidates_saved=saved,
            candidates_pending=pending,
        )

    # --------------------------- Get a single session ---------------------------
    @router.get("/session/{session_id}")
    async def get_session(
        session_id: str, owner: dict = Depends(get_owner_dep)
    ):
        db = get_db_fn()
        session = await db.walk_sessions.find_one(
            {"id": session_id, "owner_key": _owner_key(owner)}, {"_id": 0}
        )
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        # Strip the internal owner_key from the response.
        session.pop("owner_key", None)
        return session

    # --------------------------- Memory CRUD ---------------------------
    @router.get("/memory")
    async def list_memory(
        owner: dict = Depends(get_owner_dep),
        kind: Optional[str] = None,
        status: Optional[str] = None,
    ):
        db = get_db_fn()
        q: Dict[str, Any] = {"owner_key": _owner_key(owner)}
        if kind:
            q["kind"] = kind
        if status:
            q["status"] = status
        items = (
            await db.walk_memory.find(q, {"_id": 0, "owner_key": 0})
            .sort("updated_at", -1)
            .to_list(length=200)
        )
        return {"items": items}

    @router.post("/memory")
    async def create_memory(
        payload: MemoryCreate, owner: dict = Depends(get_owner_dep)
    ):
        db = get_db_fn()
        doc = await _save_memory(db, owner, payload)
        return doc

    @router.patch("/memory/{memory_id}")
    async def update_memory(
        memory_id: str,
        payload: MemoryUpdate,
        owner: dict = Depends(get_owner_dep),
    ):
        db = get_db_fn()
        update: Dict[str, Any] = {"updated_at": _now_iso()}
        if payload.content is not None:
            update["content"] = payload.content
        if payload.status is not None:
            update["status"] = payload.status
        if payload.scripture_ref is not None:
            update["scripture_ref"] = payload.scripture_ref
        result = await db.walk_memory.update_one(
            {"id": memory_id, "owner_key": _owner_key(owner)}, {"$set": update}
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Memory not found")
        doc = await db.walk_memory.find_one(
            {"id": memory_id, "owner_key": _owner_key(owner)},
            {"_id": 0, "owner_key": 0},
        )
        return doc

    @router.delete("/memory/{memory_id}")
    async def delete_memory(
        memory_id: str, owner: dict = Depends(get_owner_dep)
    ):
        db = get_db_fn()
        result = await db.walk_memory.delete_one(
            {"id": memory_id, "owner_key": _owner_key(owner)}
        )
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Memory not found")
        return {"deleted": True, "id": memory_id}

    # --------------------------- Commitment (memory kind=commitment) ---------------------------
    @router.post("/commitment")
    async def create_commitment(
        payload: CommitmentCreate, owner: dict = Depends(get_owner_dep)
    ):
        # Commitments are a memory item with kind="commitment".
        # They are created only via explicit_user_action (a tap in the UI).
        db = get_db_fn()
        doc = await _save_memory(
            db,
            owner,
            MemoryCreate(
                kind="commitment",
                content=payload.content,
                scripture_ref=payload.scripture_ref,
                confirmation_source="explicit_user_action",
                source_session_id=payload.source_session_id,
            ),
        )
        return doc

    @router.patch("/commitment/{memory_id}")
    async def update_commitment(
        memory_id: str,
        payload: CommitmentUpdate,
        owner: dict = Depends(get_owner_dep),
    ):
        # Map the human-readable status to the durable status field.
        status_map = {
            "kept": "resolved",
            "did_not": "resolved",
            "still_trying": "active",
            "resolved": "resolved",
            "active": "active",
        }
        db = get_db_fn()
        result = await db.walk_memory.update_one(
            {
                "id": memory_id,
                "owner_key": _owner_key(owner),
                "kind": "commitment",
            },
            {
                "$set": {
                    "status": status_map[payload.status],
                    "outcome": payload.status,
                    "updated_at": _now_iso(),
                }
            },
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Commitment not found")
        doc = await db.walk_memory.find_one(
            {"id": memory_id, "owner_key": _owner_key(owner)},
            {"_id": 0, "owner_key": 0},
        )
        return doc

    return router


# =============================================================================
# Internal helpers
# =============================================================================
async def _save_memory(
    db: AsyncIOMotorDatabase, owner: dict, payload: MemoryCreate
) -> Dict[str, Any]:
    doc = {
        "id": str(uuid.uuid4()),
        "owner_key": _owner_key(owner),
        **_owner_fields(owner),
        "kind": payload.kind,
        "content": payload.content.strip(),
        "scripture_ref": payload.scripture_ref,
        "status": "active",
        "confirmation_source": payload.confirmation_source,
        "source_session_id": payload.source_session_id,
        "source_message_ids": payload.source_message_ids,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "last_referenced_at": None,
    }
    await db.walk_memory.insert_one(doc)
    # Strip internal keys for the response.
    return {k: v for k, v in doc.items() if k not in ("_id", "owner_key")}


def _condense_transcript(messages: List[dict]) -> str:
    """Trim to the last ~14 turns and render as USER/COMPANION lines."""
    # Keep the opening assistant message + the last 14 user/assistant turns
    # to bound the prompt size on long sessions.
    trimmed = messages[-15:] if len(messages) > 15 else messages
    lines = []
    for m in trimmed:
        who = "USER" if m["role"] == "user" else "COMPANION"
        lines.append(f"{who}: {m['content'].strip()}")
    return "\n\n".join(lines)


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


async def _extract_candidates(messages: List[dict]) -> List[MemoryCandidate]:
    """Run the extractor prompt against the session transcript. Returns [] on
    any failure — extraction must NEVER prevent a session from closing."""
    if not messages:
        return []
    transcript_lines: List[str] = []
    for idx, m in enumerate(messages):
        who = "USER" if m["role"] == "user" else "COMPANION"
        transcript_lines.append(f"[{idx}] {who}: {m['content'].strip()}")
    transcript = "\n".join(transcript_lines)

    chat = LlmChat(
        api_key=_EMERGENT_LLM_KEY,
        session_id=f"extract:{uuid.uuid4()}",
        system_message=EXTRACTION_PROMPT,
    ).with_model(WALK_PROVIDER, WALK_MODEL)

    raw = await chat.send_message(UserMessage(text=transcript))
    text = raw if isinstance(raw, str) else str(raw)
    match = _JSON_BLOCK_RE.search(text)
    if not match:
        return []
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    out: List[MemoryCandidate] = []
    for c in (data.get("candidates") or [])[:5]:
        try:
            out.append(
                MemoryCandidate(
                    kind=c["kind"],
                    content=c["content"],
                    scripture_ref=c.get("scripture_ref"),
                    confidence=float(c.get("confidence") or 0.0),
                    confirmation_source=c.get("confirmation_source") or "unconfirmed",
                    source_message_indices=c.get("source_message_indices") or [],
                )
            )
        except Exception:  # noqa: BLE001
            # Malformed candidate — skip silently.
            continue
    return out
