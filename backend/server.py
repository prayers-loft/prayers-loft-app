from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import re
import uuid
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
AI_MODEL = "claude-sonnet-4-5-20250929"

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


async def ai_chat(system_message: str, user_text: str, session_id: Optional[str] = None) -> str:
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id or str(uuid.uuid4()),
        system_message=system_message,
    ).with_model(AI_PROVIDER, AI_MODEL)
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
    style: Literal["Devotional", "Theologian", "Pastoral"]


class ReactionRequest(BaseModel):
    verse_id: str
    emoji: str


class ReflectionCreate(BaseModel):
    text: str
    emotion: Optional[str] = None
    prompt: Optional[str] = None


class ReflectionUpdate(BaseModel):
    text: Optional[str] = None
    emotion: Optional[str] = None


# ---------- Daily verse rotation ----------
DAILY_VERSES = [
    {"reference": "Psalm 23:1", "verse": "The Lord is my shepherd; I shall not want.", "book": "PSA", "chapter": 23, "verse_num": 1},
    {"reference": "Jeremiah 29:11", "verse": "For I know the plans I have for you, declares the Lord, plans to prosper you and not to harm you, plans to give you hope and a future.", "book": "JER", "chapter": 29, "verse_num": 11},
    {"reference": "Philippians 4:6-7", "verse": "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which transcends all understanding, will guard your hearts and your minds in Christ Jesus.", "book": "PHP", "chapter": 4, "verse_num": 6},
    {"reference": "Isaiah 41:10", "verse": "So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand.", "book": "ISA", "chapter": 41, "verse_num": 10},
    {"reference": "Romans 8:28", "verse": "And we know that in all things God works for the good of those who love him, who have been called according to his purpose.", "book": "ROM", "chapter": 8, "verse_num": 28},
    {"reference": "Proverbs 3:5-6", "verse": "Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.", "book": "PRO", "chapter": 3, "verse_num": 5},
    {"reference": "Matthew 11:28", "verse": "Come to me, all you who are weary and burdened, and I will give you rest.", "book": "MAT", "chapter": 11, "verse_num": 28},
    {"reference": "Psalm 46:10", "verse": "Be still, and know that I am God.", "book": "PSA", "chapter": 46, "verse_num": 10},
    {"reference": "2 Corinthians 12:9", "verse": "But he said to me, 'My grace is sufficient for you, for my power is made perfect in weakness.'", "book": "2CO", "chapter": 12, "verse_num": 9},
    {"reference": "John 14:27", "verse": "Peace I leave with you; my peace I give you. I do not give to you as the world gives. Do not let your hearts be troubled and do not be afraid.", "book": "JHN", "chapter": 14, "verse_num": 27},
    {"reference": "Romans 12:12", "verse": "Be joyful in hope, patient in affliction, faithful in prayer.", "book": "ROM", "chapter": 12, "verse_num": 12},
    {"reference": "Lamentations 3:22-23", "verse": "Because of the Lord's great love we are not consumed, for his compassions never fail. They are new every morning; great is your faithfulness.", "book": "LAM", "chapter": 3, "verse_num": 22},
    {"reference": "Psalm 34:18", "verse": "The Lord is close to the brokenhearted and saves those who are crushed in spirit.", "book": "PSA", "chapter": 34, "verse_num": 18},
    {"reference": "Joshua 1:9", "verse": "Have I not commanded you? Be strong and courageous. Do not be afraid; do not be discouraged, for the Lord your God will be with you wherever you go.", "book": "JOS", "chapter": 1, "verse_num": 9},
]


def get_verse_for_today():
    day_of_year = datetime.now(timezone.utc).timetuple().tm_yday
    idx = day_of_year % len(DAILY_VERSES)
    v = DAILY_VERSES[idx]
    verse_id = f"{v['book']}.{v['chapter']}.{v['verse_num']}"
    return {**v, "verse_id": verse_id}


# ---------- System prompts ----------
PRAYER_REQUEST_SYSTEM = """You are a warm, spiritually grounded companion in the Prayers Loft app. The user will share a prayer request, emotion, or situation. Your response should follow this exact structure, separated by blank lines:

1. A brief, empathetic opening acknowledging their feelings (1-2 sentences, warm — like a trusted elder, never clinical).
2. Identify ONE relevant biblical character or figure who experienced something similar. Use this opening: "This reminds me of [Name]..." then share a 2-3 sentence reflection on how their story speaks to this situation.
3. Cite ONE specific Bible verse on its own line, formatted exactly as: VERSE: "<verse text>" — <Book Chapter:Verse>
   Use a real verse. The book abbreviation will be parsed from the reference — use standard names like "Psalm 23:1", "Jeremiah 29:11", "Philippians 4:6-7".
4. End with this exact question on its own line: "Would you like me to pray with you about this?"

Tone: warm, non-preachy, intimate. Never use headers, bullets, or markdown. Just flowing prose with the structure above."""

PRAYER_FOLLOWUP_SYSTEM = """You are crafting a personal prayer for the user in the Prayers Loft app. Based on their request, write a short, beautifully written, Jesus-centered prayer in the FIRST PERSON (the user is praying, not you). 

Requirements:
- 4-6 short lines, each on its own line (preserve line breaks).
- Begin with an address like "Heavenly Father," or "Lord Jesus,".
- Speak as the user would, with vulnerability and trust.
- End with "In Jesus' name, Amen." on its own final line.
- No commentary, no headers — only the prayer itself.
- Tone: tender, sincere, like a quiet whisper from the heart."""

DEVOTIONAL_SYSTEM = """You are writing a brief daily devotional for the Prayers Loft app. The user will give you a Bible verse and reference. Write a warm, reflective devotional in 2-3 short paragraphs (about 100-150 words total). 

Tone: feels like a quiet morning conversation with a trusted friend, not a sermon. Spiritually grounded, intimate, non-preachy. No headers, no bullets, just flowing prose. Speak directly to the reader using "you"."""

THEOLOGICAL_SYSTEMS = {
    "Devotional": "You are a warm, personal spiritual companion. Answer the user's theological question through the lens of the given Bible verse in a devotional style — heartfelt, personal, like a friend sharing their faith over coffee. 2-3 short paragraphs. Avoid jargon. No headers.",
    "Theologian": "You are a thoughtful Christian theologian. Answer the user's question through the lens of the given Bible verse with scholarly depth — reference original languages, historical context, and theological tradition where helpful. Stay clear and accessible. 2-3 paragraphs. No headers.",
    "Pastoral": "You are a gentle pastoral counselor. Answer the user's question through the lens of the given Bible verse with the tone of a wise pastor — empathetic, gentle, focused on the heart of the reader. Offer comfort and practical spiritual encouragement. 2-3 short paragraphs. No headers.",
}


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "Prayers Loft API"}


@api_router.post("/prayer-request")
async def prayer_request(payload: PrayerRequest):
    if not payload.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    try:
        response = await ai_chat(PRAYER_REQUEST_SYSTEM, payload.message.strip())
        return {"response": response}
    except Exception as e:
        logger.exception("prayer-request failed")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


@api_router.post("/prayer-follow-up")
async def prayer_follow_up(payload: PrayerFollowUp):
    if not payload.consent:
        raise HTTPException(status_code=400, detail="Consent required")
    try:
        prayer = await ai_chat(PRAYER_FOLLOWUP_SYSTEM, payload.message.strip())
        return {"prayer": prayer}
    except Exception as e:
        logger.exception("prayer-follow-up failed")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


@api_router.get("/daily-verse")
async def daily_verse():
    v = get_verse_for_today()
    cache_key = f"devo:{v['verse_id']}:{datetime.now(timezone.utc).date().isoformat()}"
    cached = await db.devotional_cache.find_one({"_id": cache_key})
    if cached:
        devotional = cached["devotional"]
    else:
        try:
            devotional = await ai_chat(
                DEVOTIONAL_SYSTEM,
                f"Verse: \"{v['verse']}\" — {v['reference']}",
            )
            await db.devotional_cache.insert_one({"_id": cache_key, "devotional": devotional, "created_at": now_iso()})
        except Exception as e:
            logger.exception("devotional generation failed")
            devotional = "Sit with this verse today. Let its quiet truth settle into the places that feel weary or uncertain. Sometimes the simplest words carry the deepest peace."
    return {
        "verse": v["verse"],
        "reference": v["reference"],
        "verse_id": v["verse_id"],
        "bible_link": f"https://www.bible.com/bible/1/{v['book']}.{v['chapter']}.{v['verse_num']}",
        "devotional": devotional,
    }


@api_router.post("/react-to-verse")
async def react_to_verse(payload: ReactionRequest):
    if payload.emoji not in {"🙏", "❤️", "🔥", "💡"}:
        raise HTTPException(status_code=400, detail="Invalid emoji")
    await db.reactions.update_one(
        {"verse_id": payload.verse_id, "emoji": payload.emoji},
        {"$inc": {"count": 1}, "$set": {"updated_at": now_iso()}},
        upsert=True,
    )
    doc = await db.reactions.find_one({"verse_id": payload.verse_id, "emoji": payload.emoji}, {"_id": 0})
    return {"verse_id": payload.verse_id, "emoji": payload.emoji, "count": doc.get("count", 1) if doc else 1}


@api_router.get("/get-reaction-counts")
async def get_reaction_counts(verse_id: str):
    counts = {"🙏": 0, "❤️": 0, "🔥": 0, "💡": 0}
    cursor = db.reactions.find({"verse_id": verse_id}, {"_id": 0, "emoji": 1, "count": 1})
    async for doc in cursor:
        if doc["emoji"] in counts:
            counts[doc["emoji"]] = doc["count"]
    return {"verse_id": verse_id, "counts": counts}


@api_router.post("/theological-question")
async def theological_question(payload: TheologicalQuestion):
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    system = THEOLOGICAL_SYSTEMS.get(payload.style, THEOLOGICAL_SYSTEMS["Devotional"])
    user_text = f"Verse: {payload.verse}\n\nQuestion: {payload.question.strip()}"
    try:
        response = await ai_chat(system, user_text)
        return {"response": response, "style": payload.style}
    except Exception as e:
        logger.exception("theological-question failed")
        raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")


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
