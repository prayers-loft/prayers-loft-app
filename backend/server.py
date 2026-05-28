from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import re
import uuid
import hashlib
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone

from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
AI_PROVIDER = "anthropic"
# Switched to Haiku 4.5 for faster responses (1-3s vs 5-8s on Sonnet) while keeping high quality.
AI_MODEL = "claude-haiku-4-5-20251001"

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ai_chat(system_message: str, user_text: str, session_id: Optional[str] = None, max_tokens: int = 320) -> str:
    chat = (
        LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=session_id or str(uuid.uuid4()),
            system_message=system_message,
        )
        .with_model(AI_PROVIDER, AI_MODEL)
        # Cap output length and lower temperature for faster, tighter responses.
        .with_params(max_tokens=max_tokens, temperature=0.7)
    )
    msg = UserMessage(text=user_text)
    response = await chat.send_message(msg)
    return response if isinstance(response, str) else str(response)


# ---------- Models ----------
class PrayerRequest(BaseModel):
    message: str


class PrayerFollowUp(BaseModel):
    message: str
    consent: bool = True


class TheologicalQuestion(BaseModel):
    question: str
    verse: str
    style: Literal["Devotional", "Theologian"]


class ShareExcerptRequest(BaseModel):
    text: str
    style: Literal["Devotional", "Theologian"]
    question: Optional[str] = None


class ReactionRequest(BaseModel):
    verse_id: str
    reaction: str


class ReflectionCreate(BaseModel):
    text: str
    emotion: Optional[str] = None
    prompt: Optional[str] = None


class ReflectionUpdate(BaseModel):
    text: Optional[str] = None
    emotion: Optional[str] = None


# ---------- Daily verse rotation ----------
# NLT (New Living Translation) verses with Bible.com NLT version id (116) for citation links.
DAILY_VERSES = [
    {"reference": "Psalm 23:1", "verse": "The Lord is my shepherd; I have all that I need.", "book": "PSA", "chapter": 23, "verse_num": 1},
    {"reference": "Jeremiah 29:11", "verse": "'For I know the plans I have for you,' says the Lord. 'They are plans for good and not for disaster, to give you a future and a hope.'", "book": "JER", "chapter": 29, "verse_num": 11},
    {"reference": "Philippians 4:6-7", "verse": "Don't worry about anything; instead, pray about everything. Tell God what you need, and thank him for all he has done. Then you will experience God's peace, which exceeds anything we can understand. His peace will guard your hearts and minds as you live in Christ Jesus.", "book": "PHP", "chapter": 4, "verse_num": 6},
    {"reference": "Isaiah 41:10", "verse": "Don't be afraid, for I am with you. Don't be discouraged, for I am your God. I will strengthen you and help you. I will hold you up with my victorious right hand.", "book": "ISA", "chapter": 41, "verse_num": 10},
    {"reference": "Romans 8:28", "verse": "And we know that God causes everything to work together for the good of those who love God and are called according to his purpose for them.", "book": "ROM", "chapter": 8, "verse_num": 28},
    {"reference": "Proverbs 3:5-6", "verse": "Trust in the Lord with all your heart; do not depend on your own understanding. Seek his will in all you do, and he will show you which path to take.", "book": "PRO", "chapter": 3, "verse_num": 5},
    {"reference": "Matthew 11:28", "verse": "Then Jesus said, 'Come to me, all of you who are weary and carry heavy burdens, and I will give you rest.'", "book": "MAT", "chapter": 11, "verse_num": 28},
    {"reference": "Psalm 46:10", "verse": "'Be still, and know that I am God! I will be honored by every nation. I will be honored throughout the world.'", "book": "PSA", "chapter": 46, "verse_num": 10},
    {"reference": "2 Corinthians 12:9", "verse": "Each time he said, 'My grace is all you need. My power works best in weakness.' So now I am glad to boast about my weaknesses, so that the power of Christ can work through me.", "book": "2CO", "chapter": 12, "verse_num": 9},
    {"reference": "John 14:27", "verse": "I am leaving you with a gift, peace of mind and heart. And the peace I give is a gift the world cannot give. So don't be troubled or afraid.", "book": "JHN", "chapter": 14, "verse_num": 27},
    {"reference": "Romans 12:12", "verse": "Rejoice in our confident hope. Be patient in trouble, and keep on praying.", "book": "ROM", "chapter": 12, "verse_num": 12},
    {"reference": "Lamentations 3:22-23", "verse": "The faithful love of the Lord never ends! His mercies never cease. Great is his faithfulness; his mercies begin afresh each morning.", "book": "LAM", "chapter": 3, "verse_num": 22},
    {"reference": "Psalm 34:18", "verse": "The Lord is close to the brokenhearted; he rescues those whose spirits are crushed.", "book": "PSA", "chapter": 34, "verse_num": 18},
    {"reference": "Joshua 1:9", "verse": "This is my command, be strong and courageous! Do not be afraid or discouraged. For the Lord your God is with you wherever you go.", "book": "JOS", "chapter": 1, "verse_num": 9},
]
# NLT Bible.com version id used for citation links.
BIBLE_VERSION_ID = 116


def get_verse_for_date(local_date: str):
    """Deterministic verse selection from a YYYY-MM-DD local-calendar date.
    All users sharing the same local date receive the same verse and devotional.
    """
    seed = int(hashlib.sha256(local_date.encode()).hexdigest()[:8], 16)
    idx = seed % len(DAILY_VERSES)
    v = DAILY_VERSES[idx]
    verse_id = f"{v['book']}.{v['chapter']}.{v['verse_num']}"
    return {**v, "verse_id": verse_id}


def parse_local_date(s: Optional[str]) -> str:
    """Validate YYYY-MM-DD or fall back to today's UTC date."""
    if s and re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        try:
            datetime.strptime(s, "%Y-%m-%d")
            return s
        except ValueError:
            pass
    return datetime.now(timezone.utc).date().isoformat()


# ---------- System prompts ----------
PRAYER_REQUEST_SYSTEM = """You are a warm, spiritually grounded companion in the Prayers Loft app. The user will share a prayer request, emotion, or situation. Your response should follow this exact structure, separated by blank lines:

1. A brief, empathetic opening acknowledging their feelings (1 to 2 sentences, warm like a trusted elder, never clinical).
2. Identify ONE relevant biblical character or figure who experienced something similar. Use this opening: "This reminds me of [Name]..." then share a 2 to 3 sentence reflection on how their story speaks to this situation.
3. Cite ONE specific Bible verse (NLT - New Living Translation) on its own line, formatted exactly as: VERSE: "<verse text>" (<Book Chapter:Verse>)
   Use the real NLT text. Use standard references like "Psalm 23:1", "Jeremiah 29:11", "Philippians 4:6-7".
4. End with this exact question on its own line: "Would you like me to pray with you about this?"

CRITICAL STYLE RULES:
- DO NOT use em dashes (—) or en dashes (–) anywhere in your response. Use commas, periods, or "and" instead.
- Write like a real person speaking softly to a friend. Avoid clinical phrasing, lists, bullets, headers, or markdown.
- Keep the tone warm, intimate, and non preachy. Plain flowing prose only.
- Keep it brief: total response under 120 words."""

PRAYER_FOLLOWUP_SYSTEM = """You are crafting a personal prayer for the user in the Prayers Loft app. Based on their request, write a short, beautifully written, Jesus centered prayer in the FIRST PERSON (the user is praying, not you).

Requirements:
- 4 to 6 short lines, each on its own line (preserve line breaks).
- Begin with an address like "Heavenly Father," or "Lord Jesus,".
- Speak as the user would, with vulnerability and trust.
- End with "In Jesus' name, Amen." on its own final line.
- No commentary, no headers, only the prayer itself.
- Keep it concise: under 80 words total.

CRITICAL STYLE RULES:
- DO NOT use em dashes (—) or en dashes (–). Use commas, periods, or natural sentence breaks instead.
- Tone: tender, sincere, like a quiet whisper from the heart. Sound human, never robotic."""

DEVOTIONAL_SYSTEM = """You are writing a brief daily devotional for the Prayers Loft app. The user will give you a Bible verse (NLT) and reference. Write a warm, reflective devotional in 2 short paragraphs (about 80 to 120 words total).

Tone: feels like a quiet morning conversation with a trusted friend, not a sermon. Spiritually grounded, intimate, non preachy. No headers, no bullets, just flowing prose. Speak directly to the reader using "you".

CRITICAL STYLE RULES:
- DO NOT use em dashes (—) or en dashes (–). Use commas, periods, or natural sentence breaks instead.
- Write like a human, never like an AI. Avoid hedging phrases and clinical tone."""

THEOLOGICAL_SYSTEMS = {
    "Devotional": "You are a warm, personal spiritual companion. Answer the user's theological question through the lens of the given Bible verse (NLT) in a devotional style, heartfelt and personal, like a friend sharing their faith over coffee. 2 short paragraphs, under 120 words total. Avoid jargon. No headers. CRITICAL: do not use em dashes (—) or en dashes (–) anywhere in your response. Use commas, periods, or natural pauses instead. Sound human.",
    "Theologian": "You are a thoughtful Christian theologian. Answer the user's question through the lens of the given Bible verse (NLT) with scholarly depth, referencing original languages, historical context, and theological tradition where helpful. Stay clear and accessible. 2 paragraphs, under 140 words total. No headers. CRITICAL: do not use em dashes (—) or en dashes (–) anywhere in your response. Use commas, periods, or natural pauses instead. Sound like a real teacher, not an AI.",
}


def soften_text(text: str) -> str:
    """Replace em/en dashes and markdown headers so AI output feels human."""
    if not text:
        return text
    # Strip leading markdown headers like "# Title" or "## Title".
    text = re.sub(r"^\s*#{1,6}\s.+?(?:\n|$)", "", text, count=1, flags=re.MULTILINE)
    # Em/en dashes between spaces become a comma + space.
    text = re.sub(r"\s*[—–]\s*", ", ", text)
    return text.strip()


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Prayers Loft API"}


@api_router.post("/prayer-request")
async def prayer_request(payload: PrayerRequest):
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    try:
        response = await ai_chat(PRAYER_REQUEST_SYSTEM, payload.message.strip(), max_tokens=350)
        return {"response": soften_text(response)}
    except Exception as e:
        logger.exception("prayer-request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


@api_router.post("/prayer-follow-up")
async def prayer_follow_up(payload: PrayerFollowUp):
    if not payload.consent:
        raise HTTPException(status_code=400, detail="Consent required")
    try:
        prayer = await ai_chat(PRAYER_FOLLOWUP_SYSTEM, payload.message.strip(), max_tokens=220)
        return {"prayer": soften_text(prayer)}
    except Exception as e:
        logger.exception("prayer-follow-up failed")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


@api_router.get("/daily-verse")
async def daily_verse(local_date: Optional[str] = None, tz: Optional[str] = None):
    """Returns the devotional for the user's LOCAL calendar day.

    Query params:
      local_date: YYYY-MM-DD as seen on the user's device (preferred).
      tz: IANA timezone name (e.g. America/Chicago). Stored for telemetry only.

    Verse selection is deterministic on local_date so every user sharing the
    same local day sees the same scripture. Devotional is cached per
    local_date so it is generated exactly once per day globally.
    """
    date_str = parse_local_date(local_date)
    v = get_verse_for_date(date_str)
    cache_key = f"devo:{date_str}:{v['verse_id']}"
    cached = await db.devotional_cache.find_one({"_id": cache_key})
    if cached:
        devotional = cached["devotional"]
    else:
        try:
            devotional = await ai_chat(
                DEVOTIONAL_SYSTEM,
                f"Verse: \"{v['verse']}\" ({v['reference']})",
                max_tokens=280,
            )
            devotional = soften_text(devotional)
            await db.devotional_cache.insert_one({
                "_id": cache_key,
                "devotional": devotional,
                "local_date": date_str,
                "verse_id": v["verse_id"],
                "tz_sample": tz,
                "created_at": now_iso(),
            })
        except Exception:
            logger.exception("devotional generation failed")
            devotional = "Sit with this verse today. Let its quiet truth settle into the places that feel weary or uncertain. Sometimes the simplest words carry the deepest peace."
    return {
        "verse": v["verse"],
        "reference": v["reference"],
        "verse_id": v["verse_id"],
        "bible_link": f"https://www.bible.com/bible/{BIBLE_VERSION_ID}/{v['book']}.{v['chapter']}.{v['verse_num']}",
        "devotional": devotional,
        "local_date": date_str,
    }


VALID_REACTIONS = {"pray", "love", "fire", "insight"}


@api_router.post("/react-to-verse")
async def react_to_verse(payload: ReactionRequest):
    if payload.reaction not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail="Invalid reaction")
    await db.reactions.update_one(
        {"verse_id": payload.verse_id, "reaction": payload.reaction},
        {"$inc": {"count": 1}, "$set": {"updated_at": now_iso()}},
        upsert=True,
    )
    doc = await db.reactions.find_one({"verse_id": payload.verse_id, "reaction": payload.reaction}, {"_id": 0})
    return {"verse_id": payload.verse_id, "reaction": payload.reaction, "count": doc.get("count", 1) if doc else 1}


@api_router.get("/get-reaction-counts")
async def get_reaction_counts(verse_id: str):
    counts = {r: 0 for r in VALID_REACTIONS}
    cursor = db.reactions.find({"verse_id": verse_id}, {"_id": 0, "reaction": 1, "count": 1})
    async for doc in cursor:
        if doc.get("reaction") in counts:
            counts[doc["reaction"]] = doc["count"]
    return {"verse_id": verse_id, "counts": counts}


@api_router.post("/theological-question")
async def theological_question(payload: TheologicalQuestion):
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    system = THEOLOGICAL_SYSTEMS.get(payload.style, THEOLOGICAL_SYSTEMS["Devotional"])
    user_text = f"Verse: {payload.verse}\n\nQuestion: {payload.question.strip()}"
    try:
        response = await ai_chat(system, user_text)
        return {"response": soften_text(response), "style": payload.style}
    except Exception as e:
        logger.exception("theological-question failed")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


# ---------- Share excerpt (for long Q&A responses) ----------
SHARE_EXCERPT_SYSTEMS = {
    "Devotional": (
        "You craft share-worthy excerpts from devotional reflections for social media. "
        "Given a longer devotional response, extract or compose a 1 to 3 sentence excerpt (max 280 characters) "
        "that preserves emotional impact and spiritual meaning, reads beautifully on its own, and feels share-worthy. "
        "Prefer the most resonant, quotable line. Use plain flowing prose. "
        "Return ONLY the excerpt text, no quotes, no preamble, no labels. "
        "CRITICAL: do not use em dashes or en dashes. Use commas, periods, or natural pauses."
    ),
    "Theologian": (
        "You craft share-worthy excerpts from theological reflections for social media. "
        "Given a longer theological response, extract or compose a 1 to 3 sentence excerpt (max 280 characters) "
        "that preserves the core theological insight and feels intellectually elegant. "
        "Keep it accessible and emotionally powerful. "
        "Return ONLY the excerpt text, no quotes, no preamble, no labels. "
        "CRITICAL: do not use em dashes or en dashes. Use commas, periods, or natural pauses."
    ),
}


def _excerpt_cache_key(text: str, style: str) -> str:
    h = hashlib.sha256(f"{style}::{text}".encode("utf-8")).hexdigest()[:24]
    return f"excerpt:{style}:{h}"


def _clean_excerpt(s: str) -> str:
    s = soften_text(s or "").strip()
    # Strip surrounding quotes if Claude wrapped the line.
    if len(s) >= 2 and s[0] in '"\u201c\u2018' and s[-1] in '"\u201d\u2019':
        s = s[1:-1].strip()
    # Cap to 300 chars hard limit so designs never overflow.
    if len(s) > 300:
        s = s[:297].rstrip() + "..."
    return s


@api_router.post("/share-excerpt")
async def share_excerpt(payload: ShareExcerptRequest):
    """Generate (or fetch cached) emotionally powerful 1-3 sentence excerpt
    from a long Q&A response, suitable for a social share image.
    """
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    key = _excerpt_cache_key(text, payload.style)
    cached = await db.share_excerpts.find_one({"_id": key})
    if cached and cached.get("excerpt"):
        return {"excerpt": cached["excerpt"], "cached": True}

    system = SHARE_EXCERPT_SYSTEMS.get(payload.style, SHARE_EXCERPT_SYSTEMS["Devotional"])
    user_text = text
    if payload.question:
        user_text = f"Question asked: {payload.question.strip()}\n\nResponse:\n{text}"
    try:
        raw = await ai_chat(system, user_text, max_tokens=160)
        excerpt = _clean_excerpt(raw)
        if not excerpt:
            # Fallback: truncate the original.
            excerpt = (text[:277] + "...") if len(text) > 280 else text
        await db.share_excerpts.update_one(
            {"_id": key},
            {"$set": {"_id": key, "excerpt": excerpt, "style": payload.style, "created_at": now_iso()}},
            upsert=True,
        )
        return {"excerpt": excerpt, "cached": False}
    except Exception as e:
        logger.exception("share-excerpt failed")
        # Soft fallback so client UX never breaks. Do not leak internal error.
        excerpt = (text[:277] + "...") if len(text) > 280 else text
        return {"excerpt": excerpt, "cached": False, "fallback": True}


@api_router.post("/reflections")
async def create_reflection(payload: ReflectionCreate):
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    entry = {
        "id": str(uuid.uuid4()),
        "text": payload.text.strip(),
        "emotion": payload.emotion,
        "prompt": payload.prompt,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.reflections.insert_one({**entry})
    # Remove any mutated _id before returning
    entry.pop("_id", None)
    return entry


@api_router.get("/reflections")
async def list_reflections():
    items = []
    cursor = db.reflections.find({}, {"_id": 0}).sort("created_at", -1)
    async for doc in cursor:
        items.append(doc)
    return {"reflections": items}


@api_router.put("/reflections/{reflection_id}")
async def update_reflection(reflection_id: str, payload: ReflectionUpdate):
    update_doc = {"updated_at": now_iso()}
    if payload.text is not None:
        update_doc["text"] = payload.text.strip()
    if payload.emotion is not None:
        update_doc["emotion"] = payload.emotion
    result = await db.reflections.update_one({"id": reflection_id}, {"$set": update_doc})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Reflection not found")
    doc = await db.reflections.find_one({"id": reflection_id}, {"_id": 0})
    return doc


@api_router.delete("/reflections/{reflection_id}")
async def delete_reflection(reflection_id: str):
    result = await db.reflections.delete_one({"id": reflection_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Reflection not found")
    return {"deleted": True, "id": reflection_id}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
