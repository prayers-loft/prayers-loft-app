"""
Phase 2 — Authentication, sessions, and guest→account migration.

Providers:
  - email/password  (bcrypt + custom HS256 JWT access + opaque refresh tokens)
  - google          (Emergent-managed Google Auth — backend session-exchange only)
  - apple           (feature-flagged off via APPLE_SIGN_IN_ENABLED; verifier code present but inactive)

Design notes:
  - All external IDs are UUIDs in `id`; never expose `_id` outside the API.
  - Single `users` collection — Email / Google / Apple identities embedded under `auth_email`,
    `auth_google`, `auth_apple`. Account-linking by email is performed at sign-in time so a
    given email only ever results in one user document across providers.
  - All providers issue our own access JWT + opaque rotating refresh token, so /api/auth/me
    is provider-agnostic.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

import bcrypt
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt as jose_jwt
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel, EmailStr, Field, constr

from email_service import send_password_reset_email

logger = logging.getLogger("prayers_loft.auth")

# ---------------------------------------------------------------------------
# Config (lazy reads — .env is loaded by server.py before module import)
# ---------------------------------------------------------------------------
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ISSUER = os.environ.get("JWT_ISSUER", "prayers-loft")
JWT_AUDIENCE = os.environ.get("JWT_AUDIENCE", "prayers-loft-mobile")
JWT_ALG = "HS256"
ACCESS_TTL_MIN = 15
REFRESH_TTL_DAYS = 30
BCRYPT_ROUNDS = 12

APPLE_SIGN_IN_ENABLED = os.environ.get("APPLE_SIGN_IN_ENABLED", "false").lower() == "true"
APPLE_TEST_MODE = os.environ.get("APPLE_TEST_MODE", "false").lower() == "true"
APPLE_SERVICES_ID = os.environ.get("APPLE_SERVICES_ID", "")
APPLE_ISSUER = "https://appleid.apple.com"

EMERGENT_SESSION_DATA_URL = (
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
)

# Brute-force thresholds (15-min sliding window)
MAX_EMAIL_FAILURES = 5
MAX_IP_FAILURES = 20
LOCKOUT_MINUTES = 15


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utcnow_iso() -> str:
    return utcnow().isoformat()


def _normalize_dt(d: Optional[datetime]) -> Optional[datetime]:
    """Mongo round-trips naive datetimes; normalize back to UTC-aware."""
    if d is None:
        return None
    if d.tzinfo is None:
        return d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("utf-8")


def verify_password(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), h.encode("utf-8"))
    except Exception:
        return False


def _make_access_token(user_id: str, session_id: str) -> str:
    now = utcnow()
    payload = {
        "sub": user_id,
        "sid": session_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TTL_MIN)).timestamp()),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
    }
    return jose_jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def _hash_refresh(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _shape_user(user_doc: Dict[str, Any]) -> Dict[str, Any]:
    """Public-facing user shape returned from /api/auth/me, /login, /register, /google."""
    providers: List[str] = []
    if user_doc.get("auth_email"):
        providers.append("email")
    if user_doc.get("auth_google"):
        providers.append("google")
    if user_doc.get("auth_apple"):
        providers.append("apple")
    return {
        "id": user_doc["id"],
        "email": user_doc.get("email"),
        "name": user_doc.get("name"),
        "picture": user_doc.get("picture"),
        "providers": providers,
        "createdAt": _normalize_dt(user_doc.get("created_at")).isoformat() if user_doc.get("created_at") else None,
    }


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class AuthTokens(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class AuthResponse(BaseModel):
    user: Dict[str, Any]
    tokens: AuthTokens


class RegisterRequest(BaseModel):
    email: EmailStr
    password: constr(min_length=8, max_length=128)
    name: Optional[constr(max_length=80)] = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: constr(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: constr(min_length=16, max_length=128)
    new_password: constr(min_length=8, max_length=128)


class GoogleSessionExchangeRequest(BaseModel):
    session_id: str  # one-time session id from Emergent-managed Google return URL


class AppleLoginRequest(BaseModel):
    identityToken: str
    nonce: Optional[str] = None


# ---------------------------------------------------------------------------
# Migration models
# ---------------------------------------------------------------------------
class SavedPrayerItem(BaseModel):
    id: str
    text: str
    scripture: Optional[str] = None
    createdAt: Optional[str] = None


class SavedScriptureItem(BaseModel):
    verse_id: str
    savedAt: Optional[str] = None
    text: Optional[str] = None


class ReflectionItem(BaseModel):
    id: Optional[str] = None
    text: str
    emotion: Optional[str] = None
    prompt: Optional[str] = None
    created_at: Optional[str] = None


class DevotionalHistoryItem(BaseModel):
    local_date: str  # YYYY-MM-DD
    verse_id: str
    devotional_text: Optional[str] = None


class StreakMeta(BaseModel):
    currentStreak: int = 0
    longestStreak: int = 0
    lastReflectionDate: Optional[str] = None


class GuestMigrationPayload(BaseModel):
    guest_id: str
    savedPrayers: List[SavedPrayerItem] = Field(default_factory=list)
    savedScriptures: List[SavedScriptureItem] = Field(default_factory=list)
    reflections: List[ReflectionItem] = Field(default_factory=list)
    devotionalHistory: List[DevotionalHistoryItem] = Field(default_factory=list)
    preferences: Dict[str, Any] = Field(default_factory=dict)
    streakMeta: StreakMeta = Field(default_factory=StreakMeta)


class MigrationResult(BaseModel):
    ok: bool
    already_migrated: bool
    migrated_counts: Dict[str, int]
    new_streak: StreakMeta
    message: str


# ---------------------------------------------------------------------------
# Index creation (called from server.py startup)
# ---------------------------------------------------------------------------
async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    try:
        await db.users.create_index("id", unique=True)
        await db.users.create_index("email", sparse=True)
        await db.users.create_index("auth_google.google_sub", sparse=True)
        await db.users.create_index("auth_apple.apple_sub", sparse=True)
        await db.user_sessions.create_index("id", unique=True)
        await db.user_sessions.create_index("user_id")
        await db.refresh_tokens.create_index("token_hash", unique=True)
        await db.refresh_tokens.create_index("session_id")
        await db.refresh_tokens.create_index("expires_at", expireAfterSeconds=0)
        await db.password_reset_tokens.create_index("token_hash", unique=True)
        await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
        await db.login_attempts.create_index("created_at", expireAfterSeconds=60 * 60)
        await db.guest_migrations.create_index(
            [("guest_id", 1), ("user_id", 1)], unique=True
        )
        await db.saved_prayers.create_index([("user_id", 1), ("client_id", 1)], unique=True)
        await db.saved_scriptures.create_index([("user_id", 1), ("verse_id", 1)], unique=True)
        await db.user_preferences.create_index("user_id", unique=True)
        await db.user_devotional_history.create_index(
            [("user_id", 1), ("local_date", 1)], unique=True
        )
        logger.info("auth indexes ensured")
    except Exception as e:
        logger.warning(f"ensure_indexes: {e!r}")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
async def _create_session(db, user_id: str, provider: str, request: Optional[Request] = None) -> str:
    sid = str(uuid.uuid4())
    doc = {
        "id": sid,
        "user_id": user_id,
        "provider": provider,
        "created_at": utcnow(),
        "last_seen_at": utcnow(),
        "revoked": False,
        "ip": request.client.host if request and request.client else None,
        "user_agent": (request.headers.get("user-agent") if request else None) or None,
    }
    await db.user_sessions.insert_one(doc)
    return sid


async def _issue_refresh(db, user_id: str, session_id: str) -> str:
    raw = secrets.token_urlsafe(48)
    await db.refresh_tokens.insert_one(
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "session_id": session_id,
            "token_hash": _hash_refresh(raw),
            "created_at": utcnow(),
            "expires_at": utcnow() + timedelta(days=REFRESH_TTL_DAYS),
            "revoked": False,
            "replaced_by": None,
        }
    )
    return raw


async def _issue_tokens(db, user_id: str, session_id: str) -> AuthTokens:
    return AuthTokens(
        access_token=_make_access_token(user_id, session_id),
        refresh_token=await _issue_refresh(db, user_id, session_id),
    )


async def _record_login_failure(db, email: str, ip: str) -> None:
    await db.login_attempts.insert_one(
        {"email": email, "ip": ip, "created_at": utcnow()}
    )


async def _failure_counts(db, email: str, ip: str) -> tuple[int, int]:
    cutoff = utcnow() - timedelta(minutes=LOCKOUT_MINUTES)
    email_count = await db.login_attempts.count_documents(
        {"email": email, "created_at": {"$gte": cutoff}}
    )
    ip_count = await db.login_attempts.count_documents(
        {"ip": ip, "created_at": {"$gte": cutoff}}
    )
    return email_count, ip_count


# ---------------------------------------------------------------------------
# Current-user dependency
# ---------------------------------------------------------------------------
_bearer = HTTPBearer(auto_error=False)


def make_current_user_dep(get_db_fn):
    """Factory: server.py provides its `db` getter; we return a FastAPI dependency."""
    async def _current_user(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    ) -> Dict[str, Any]:
        if credentials is None or not credentials.credentials:
            raise HTTPException(status_code=401, detail="Not authenticated")
        token = credentials.credentials
        try:
            payload = jose_jwt.decode(
                token,
                JWT_SECRET,
                algorithms=[JWT_ALG],
                audience=JWT_AUDIENCE,
                issuer=JWT_ISSUER,
            )
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid token")
        user_id = payload.get("sub")
        session_id = payload.get("sid")
        if not user_id or not session_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")

        db = get_db_fn()
        session = await db.user_sessions.find_one({"id": session_id}, {"_id": 0})
        if not session or session.get("revoked"):
            raise HTTPException(status_code=401, detail="Session revoked")

        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user

    return _current_user


# ---------------------------------------------------------------------------
# Account linking by email
# ---------------------------------------------------------------------------
async def _link_or_create_user(
    db,
    *,
    email: Optional[str],
    name: Optional[str] = None,
    picture: Optional[str] = None,
    google_sub: Optional[str] = None,
    apple_sub: Optional[str] = None,
    email_password_hash: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Find-or-create user with strict deduplication:
      1. If google_sub provided, look up users.auth_google.google_sub.
      2. Else if apple_sub provided, look up users.auth_apple.apple_sub.
      3. Else / fallback by email (normalized lowercase).
    If found, attach new provider identity fields.
    """
    now = utcnow()
    norm_email = email.lower().strip() if email else None

    existing = None
    if google_sub:
        existing = await db.users.find_one({"auth_google.google_sub": google_sub})
    if not existing and apple_sub:
        existing = await db.users.find_one({"auth_apple.apple_sub": apple_sub})
    if not existing and norm_email:
        existing = await db.users.find_one({"email": norm_email})

    if existing:
        set_doc: Dict[str, Any] = {"updated_at": now}
        if google_sub and not existing.get("auth_google"):
            set_doc["auth_google"] = {
                "google_sub": google_sub,
                "created_at": now,
                "last_login_at": now,
            }
        elif google_sub:
            set_doc["auth_google.last_login_at"] = now
        if apple_sub and not existing.get("auth_apple"):
            set_doc["auth_apple"] = {
                "apple_sub": apple_sub,
                "created_at": now,
                "last_login_at": now,
            }
        elif apple_sub:
            set_doc["auth_apple.last_login_at"] = now
        if email_password_hash and not existing.get("auth_email"):
            set_doc["auth_email"] = {
                "password_hash": email_password_hash,
                "email_verified": False,
                "created_at": now,
                "last_login_at": now,
            }
        elif email_password_hash:
            # Caller (register) should have refused before reaching here; safeguard.
            raise HTTPException(status_code=400, detail="Email already registered")
        if not existing.get("email") and norm_email:
            set_doc["email"] = norm_email
        if not existing.get("name") and name:
            set_doc["name"] = name
        if not existing.get("picture") and picture:
            set_doc["picture"] = picture
        if set_doc:
            await db.users.update_one({"id": existing["id"]}, {"$set": set_doc})
        return await db.users.find_one({"id": existing["id"]}, {"_id": 0})

    # Create
    user_id = str(uuid.uuid4())
    new_doc: Dict[str, Any] = {
        "id": user_id,
        "email": norm_email,
        "name": name,
        "picture": picture,
        "created_at": now,
        "updated_at": now,
    }
    if email_password_hash:
        new_doc["auth_email"] = {
            "password_hash": email_password_hash,
            "email_verified": False,
            "created_at": now,
            "last_login_at": now,
        }
    if google_sub:
        new_doc["auth_google"] = {
            "google_sub": google_sub,
            "created_at": now,
            "last_login_at": now,
        }
    if apple_sub:
        new_doc["auth_apple"] = {
            "apple_sub": apple_sub,
            "created_at": now,
            "last_login_at": now,
        }
    await db.users.insert_one({**new_doc})
    return await db.users.find_one({"id": user_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Router builder
# ---------------------------------------------------------------------------
def build_auth_router(get_db_fn) -> APIRouter:
    """
    Returns the /api/auth + /api/account router. server.py mounts it.
    `get_db_fn` is a zero-arg callable returning the AsyncIOMotorDatabase.
    """
    router = APIRouter()
    current_user = make_current_user_dep(get_db_fn)

    # ------------------------- /auth/register -------------------------
    @router.post("/auth/register", response_model=AuthResponse)
    async def register(payload: RegisterRequest, request: Request):
        db = get_db_fn()
        email = payload.email.lower().strip()
        existing = await db.users.find_one({"email": email}, {"_id": 0})
        if existing and existing.get("auth_email"):
            raise HTTPException(status_code=400, detail="Email already registered")
        pw_hash = hash_password(payload.password)
        user = await _link_or_create_user(
            db,
            email=email,
            name=payload.name,
            email_password_hash=pw_hash,
        )
        sid = await _create_session(db, user["id"], "email", request)
        tokens = await _issue_tokens(db, user["id"], sid)
        return AuthResponse(user=_shape_user(user), tokens=tokens)

    # ------------------------- /auth/login -------------------------
    @router.post("/auth/login", response_model=AuthResponse)
    async def login(payload: LoginRequest, request: Request):
        db = get_db_fn()
        email = payload.email.lower().strip()
        ip = request.client.host if request.client else "0.0.0.0"

        email_fails, ip_fails = await _failure_counts(db, email, ip)
        if email_fails >= MAX_EMAIL_FAILURES or ip_fails >= MAX_IP_FAILURES:
            raise HTTPException(
                status_code=429,
                detail="Too many failed attempts. Please try again later.",
            )

        user = await db.users.find_one({"email": email}, {"_id": 0})
        if not user or not user.get("auth_email"):
            await _record_login_failure(db, email, ip)
            raise HTTPException(status_code=401, detail="Invalid email or password")

        if not verify_password(payload.password, user["auth_email"]["password_hash"]):
            await _record_login_failure(db, email, ip)
            raise HTTPException(status_code=401, detail="Invalid email or password")

        # success — clear failure window for this email
        await db.login_attempts.delete_many({"email": email})
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"auth_email.last_login_at": utcnow(), "updated_at": utcnow()}},
        )
        sid = await _create_session(db, user["id"], "email", request)
        tokens = await _issue_tokens(db, user["id"], sid)
        return AuthResponse(user=_shape_user(user), tokens=tokens)

    # ------------------------- /auth/me -------------------------
    @router.get("/auth/me")
    async def me(user=Depends(current_user)):
        return _shape_user(user)

    # ------------------------- /auth/refresh -------------------------
    @router.post("/auth/refresh", response_model=AuthTokens)
    async def refresh(payload: RefreshRequest):
        db = get_db_fn()
        token_doc = await db.refresh_tokens.find_one(
            {"token_hash": _hash_refresh(payload.refresh_token)}, {"_id": 0}
        )
        if not token_doc:
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        exp = _normalize_dt(token_doc.get("expires_at"))
        if token_doc.get("revoked") or (exp and exp < utcnow()):
            # Reuse/expiry → revoke everything in the session for safety
            await db.refresh_tokens.update_many(
                {"session_id": token_doc["session_id"]},
                {"$set": {"revoked": True}},
            )
            raise HTTPException(status_code=401, detail="Refresh token expired or revoked")

        await db.refresh_tokens.update_one(
            {"id": token_doc["id"]}, {"$set": {"revoked": True}}
        )
        new_raw = await _issue_refresh(db, token_doc["user_id"], token_doc["session_id"])
        await db.refresh_tokens.update_one(
            {"id": token_doc["id"]},
            {"$set": {"replaced_by": _hash_refresh(new_raw)}},
        )
        return AuthTokens(
            access_token=_make_access_token(token_doc["user_id"], token_doc["session_id"]),
            refresh_token=new_raw,
        )

    # ------------------------- /auth/logout -------------------------
    @router.post("/auth/logout")
    async def logout(payload: LogoutRequest):
        db = get_db_fn()
        if not payload.refresh_token:
            return {"ok": True}
        doc = await db.refresh_tokens.find_one(
            {"token_hash": _hash_refresh(payload.refresh_token)}, {"_id": 0}
        )
        if not doc:
            return {"ok": True}
        await db.refresh_tokens.update_many(
            {"session_id": doc["session_id"]}, {"$set": {"revoked": True}}
        )
        await db.user_sessions.update_one(
            {"id": doc["session_id"]}, {"$set": {"revoked": True}}
        )
        return {"ok": True}

    # ------------------------- /auth/password-reset/request -------------------------
    @router.post("/auth/password-reset/request")
    async def password_reset_request(payload: PasswordResetRequest):
        """
        Always returns 200 (avoids email enumeration). If the email belongs to
        an email-auth user AND Resend is configured, sends a reset email.
        """
        db = get_db_fn()
        email = payload.email.lower().strip()
        user = await db.users.find_one({"email": email}, {"_id": 0})
        if user and user.get("auth_email"):
            raw = secrets.token_urlsafe(32)
            await db.password_reset_tokens.insert_one(
                {
                    "id": str(uuid.uuid4()),
                    "user_id": user["id"],
                    "token_hash": _hash_refresh(raw),
                    "created_at": utcnow(),
                    "expires_at": utcnow() + timedelta(minutes=30),
                    "consumed": False,
                }
            )
            try:
                await send_password_reset_email(email, raw)
            except Exception as e:
                logger.warning(f"password-reset email send failed: {e!r}")
        return {"ok": True, "message": "If that email is registered, a reset link is on its way."}

    # ------------------------- /auth/password-reset/confirm -------------------------
    @router.post("/auth/password-reset/confirm")
    async def password_reset_confirm(payload: PasswordResetConfirm):
        db = get_db_fn()
        token_doc = await db.password_reset_tokens.find_one(
            {"token_hash": _hash_refresh(payload.token)}, {"_id": 0}
        )
        if not token_doc or token_doc.get("consumed"):
            raise HTTPException(status_code=400, detail="Invalid or used reset link")
        exp = _normalize_dt(token_doc.get("expires_at"))
        if exp and exp < utcnow():
            raise HTTPException(status_code=400, detail="Reset link expired")
        new_hash = hash_password(payload.new_password)
        await db.users.update_one(
            {"id": token_doc["user_id"]},
            {"$set": {"auth_email.password_hash": new_hash, "updated_at": utcnow()}},
        )
        await db.password_reset_tokens.update_one(
            {"id": token_doc["id"]}, {"$set": {"consumed": True, "consumed_at": utcnow()}}
        )
        # Revoke all existing sessions for safety.
        await db.refresh_tokens.update_many(
            {"user_id": token_doc["user_id"]}, {"$set": {"revoked": True}}
        )
        await db.user_sessions.update_many(
            {"user_id": token_doc["user_id"]}, {"$set": {"revoked": True}}
        )
        return {"ok": True, "message": "Password updated. You can now sign in."}

    # ------------------------- /auth/google -------------------------
    @router.post("/auth/google", response_model=AuthResponse)
    async def google_exchange(payload: GoogleSessionExchangeRequest, request: Request):
        """
        Exchange a one-time Emergent session_id (from the OAuth return URL) for our own
        JWT + refresh token. We call Emergent's session-data endpoint to fetch the user.
        """
        db = get_db_fn()
        async with httpx.AsyncClient(timeout=10.0) as client_:
            try:
                r = await client_.get(
                    EMERGENT_SESSION_DATA_URL,
                    headers={"X-Session-ID": payload.session_id},
                )
            except Exception:
                raise HTTPException(status_code=502, detail="Auth provider unreachable")
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google session")
        data = r.json()
        google_email = (data.get("email") or "").lower().strip() or None
        google_sub = data.get("id") or data.get("sub")
        if not google_sub:
            raise HTTPException(status_code=401, detail="Google session missing user id")

        user = await _link_or_create_user(
            db,
            email=google_email,
            name=data.get("name"),
            picture=data.get("picture"),
            google_sub=google_sub,
        )
        sid = await _create_session(db, user["id"], "google", request)
        tokens = await _issue_tokens(db, user["id"], sid)
        return AuthResponse(user=_shape_user(user), tokens=tokens)

    # ------------------------- /auth/apple (feature-flagged) -------------------------
    @router.post("/auth/apple", response_model=AuthResponse)
    async def apple_login(payload: AppleLoginRequest, request: Request):
        if not APPLE_SIGN_IN_ENABLED and not APPLE_TEST_MODE:
            raise HTTPException(status_code=503, detail="Apple Sign-In not enabled")

        db = get_db_fn()
        if APPLE_TEST_MODE and payload.identityToken.startswith("TEST."):
            # E2E-friendly stub: TEST.<sub>.<email-or-empty>
            parts = payload.identityToken.split(".")
            apple_sub = parts[1] if len(parts) > 1 else "test_sub"
            apple_email = (parts[2] if len(parts) > 2 and parts[2] else None)
        else:
            # Real Apple verification path (kept for when APPLE_SIGN_IN_ENABLED=true)
            try:
                async with httpx.AsyncClient(timeout=10.0) as client_:
                    keys_resp = await client_.get("https://appleid.apple.com/auth/keys")
                jwks = keys_resp.json()
            except Exception:
                raise HTTPException(status_code=502, detail="Apple keys unreachable")
            try:
                header = jose_jwt.get_unverified_header(payload.identityToken)
                key = next((k for k in jwks["keys"] if k["kid"] == header["kid"]), None)
                if not key:
                    raise HTTPException(status_code=401, detail="Unknown Apple key id")
                claims = jose_jwt.decode(
                    payload.identityToken,
                    key,
                    algorithms=[header["alg"]],
                    audience=APPLE_SERVICES_ID,
                    issuer=APPLE_ISSUER,
                )
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=401, detail="Invalid Apple identity token")
            if payload.nonce and claims.get("nonce") != payload.nonce:
                raise HTTPException(status_code=401, detail="Apple nonce mismatch")
            apple_sub = claims["sub"]
            apple_email = claims.get("email")

        user = await _link_or_create_user(
            db,
            email=apple_email,
            apple_sub=apple_sub,
        )
        sid = await _create_session(db, user["id"], "apple", request)
        tokens = await _issue_tokens(db, user["id"], sid)
        return AuthResponse(user=_shape_user(user), tokens=tokens)

    # ------------------------- /account/migrate-guest -------------------------
    @router.post("/account/migrate-guest", response_model=MigrationResult)
    async def migrate_guest(
        payload: GuestMigrationPayload, user=Depends(current_user)
    ):
        db = get_db_fn()
        user_id = user["id"]
        guest_id = payload.guest_id.strip()
        if not guest_id:
            raise HTTPException(status_code=400, detail="guest_id required")

        # Idempotency: lock on (guest_id, user_id)
        existing = await db.guest_migrations.find_one(
            {"guest_id": guest_id, "user_id": user_id}, {"_id": 0}
        )
        # Cross-user guard: if guest_id already migrated to a DIFFERENT user, refuse
        other_user_doc = await db.guest_migrations.find_one(
            {"guest_id": guest_id, "user_id": {"$ne": user_id}}, {"_id": 0}
        )
        if other_user_doc:
            raise HTTPException(
                status_code=409, detail="This device's guest data is already linked to another account."
            )

        migrated = {
            "prayers": 0,
            "scriptures": 0,
            "reflections": 0,
            "devotional_history": 0,
            "preferences": 0,
        }

        # ---- prayers ----
        for p in payload.savedPrayers:
            createdAt = p.createdAt or utcnow_iso()
            try:
                res = await db.saved_prayers.update_one(
                    {"user_id": user_id, "client_id": p.id},
                    {
                        "$setOnInsert": {
                            "user_id": user_id,
                            "client_id": p.id,
                            "text": p.text,
                            "scripture": p.scripture,
                            "guest_id": guest_id,
                        },
                        # $min keeps the earliest createdAt across replays
                        "$min": {"created_at": createdAt},
                    },
                    upsert=True,
                )
                if res.upserted_id is not None:
                    migrated["prayers"] += 1
            except Exception as e:
                logger.warning(f"prayer upsert failed: {e!r}")

        # ---- scriptures ----
        for s in payload.savedScriptures:
            try:
                res = await db.saved_scriptures.update_one(
                    {"user_id": user_id, "verse_id": s.verse_id},
                    {
                        "$setOnInsert": {
                            "user_id": user_id,
                            "verse_id": s.verse_id,
                            "saved_at": s.savedAt or utcnow_iso(),
                            "text": s.text,
                            "guest_id": guest_id,
                        }
                    },
                    upsert=True,
                )
                if res.upserted_id is not None:
                    migrated["scriptures"] += 1
            except Exception as e:
                logger.warning(f"scripture upsert failed: {e!r}")

        # ---- reflections (dedupe by client id when provided) ----
        for r in payload.reflections:
            client_id = r.id or str(uuid.uuid4())
            existing_r = await db.reflections.find_one(
                {"$or": [{"id": client_id}, {"user_id": user_id, "client_id": client_id}]},
                {"_id": 0, "id": 1, "user_id": 1},
            )
            if existing_r:
                # Tag existing reflection to user if it wasn't already
                await db.reflections.update_one(
                    {"id": existing_r["id"]},
                    {"$set": {"user_id": user_id, "guest_id": guest_id}},
                )
                continue
            try:
                await db.reflections.insert_one(
                    {
                        "id": client_id,
                        "client_id": client_id,
                        "user_id": user_id,
                        "guest_id": guest_id,
                        "text": r.text,
                        "emotion": r.emotion,
                        "prompt": r.prompt,
                        "created_at": r.created_at or utcnow_iso(),
                        "updated_at": r.created_at or utcnow_iso(),
                    }
                )
                migrated["reflections"] += 1
            except Exception as e:
                logger.warning(f"reflection insert failed: {e!r}")

        # ---- devotional history ----
        for d in payload.devotionalHistory:
            try:
                res = await db.user_devotional_history.update_one(
                    {"user_id": user_id, "local_date": d.local_date},
                    {
                        "$setOnInsert": {
                            "user_id": user_id,
                            "local_date": d.local_date,
                            "verse_id": d.verse_id,
                            "devotional_text": d.devotional_text,
                            "guest_id": guest_id,
                        }
                    },
                    upsert=True,
                )
                if res.upserted_id is not None:
                    migrated["devotional_history"] += 1
            except Exception as e:
                logger.warning(f"devo history upsert failed: {e!r}")

        # ---- preferences (merge — server-overrides only if absent) ----
        if payload.preferences:
            res = await db.user_preferences.update_one(
                {"user_id": user_id},
                {
                    "$setOnInsert": {
                        "user_id": user_id,
                        **payload.preferences,
                        "updated_at": utcnow_iso(),
                    }
                },
                upsert=True,
            )
            if res.upserted_id is not None:
                migrated["preferences"] = 1

        # ---- recompute streak deterministically ----
        all_dates = set()
        cursor = db.reflections.find({"user_id": user_id}, {"_id": 0, "created_at": 1})
        async for r in cursor:
            ts = r.get("created_at") or ""
            if isinstance(ts, str) and len(ts) >= 10:
                all_dates.add(ts[:10])
        cursor2 = db.user_devotional_history.find(
            {"user_id": user_id}, {"_id": 0, "local_date": 1}
        )
        async for d in cursor2:
            if d.get("local_date"):
                all_dates.add(d["local_date"][:10])

        sorted_dates = sorted(all_dates)
        longest = 0
        current_run = 0
        prev: Optional[datetime] = None
        for s in sorted_dates:
            try:
                cur = datetime.strptime(s, "%Y-%m-%d")
            except Exception:
                continue
            if prev is not None and (cur - prev).days == 1:
                current_run += 1
            else:
                current_run = 1
            longest = max(longest, current_run)
            prev = cur

        # current = trailing run if last date is today or yesterday
        today = utcnow().date()
        if prev is not None and (today - prev.date()).days in (0, 1):
            current = current_run
        else:
            current = 0
        last_date_iso = sorted_dates[-1] if sorted_dates else None

        new_streak = StreakMeta(
            currentStreak=current,
            longestStreak=longest,
            lastReflectionDate=last_date_iso,
        )

        # Idempotency record + counts (preserve first-pass counts if replay)
        if existing:
            return MigrationResult(
                ok=True,
                already_migrated=True,
                migrated_counts=existing.get("migrated_counts", migrated),
                new_streak=new_streak,
                message="Your spiritual journey has been safely saved.",
            )
        await db.guest_migrations.insert_one(
            {
                "guest_id": guest_id,
                "user_id": user_id,
                "migrated_counts": migrated,
                "created_at": utcnow(),
            }
        )
        return MigrationResult(
            ok=True,
            already_migrated=False,
            migrated_counts=migrated,
            new_streak=new_streak,
            message="Your spiritual journey has been safely saved.",
        )

    # ------------------------- /account/saved-prayers (read-back after migration) -------------------------
    @router.get("/account/saved-prayers")
    async def list_saved_prayers(user=Depends(current_user)):
        db = get_db_fn()
        out = []
        async for p in db.saved_prayers.find({"user_id": user["id"]}, {"_id": 0}):
            out.append(p)
        return {"prayers": out}

    # ------------------------- /account/me (DELETE) -------------------------
    @router.delete("/account/me")
    async def delete_account(user=Depends(current_user)):
        """
        Delete the authenticated account and all cloud data.
          - Revokes all sessions and refresh tokens
          - Soft-deletes the user (marks deleted_at) so the id stays valid for FK
            on historical records but the user can no longer sign in
          - Hard-deletes cloud-only artifacts: saved_prayers, saved_scriptures,
            user_preferences, user_devotional_history, guest_migrations,
            password_reset_tokens, and reflections WHERE user_id == this user
        """
        db = get_db_fn()
        user_id = user["id"]
        # Revoke sessions + refresh tokens
        await db.refresh_tokens.update_many({"user_id": user_id}, {"$set": {"revoked": True}})
        await db.user_sessions.update_many({"user_id": user_id}, {"$set": {"revoked": True}})
        # Purge cloud data
        await db.saved_prayers.delete_many({"user_id": user_id})
        await db.saved_scriptures.delete_many({"user_id": user_id})
        await db.user_preferences.delete_many({"user_id": user_id})
        await db.user_devotional_history.delete_many({"user_id": user_id})
        await db.guest_migrations.delete_many({"user_id": user_id})
        await db.password_reset_tokens.delete_many({"user_id": user_id})
        await db.reflections.delete_many({"user_id": user_id})
        # Soft-delete user — keep the row but clear PII and credentials
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "email": None,
                    "name": None,
                    "picture": None,
                    "auth_email": None,
                    "auth_google": None,
                    "auth_apple": None,
                    "deleted_at": utcnow(),
                    "updated_at": utcnow(),
                }
            },
        )
        return {"ok": True, "message": "Your account and cloud data have been removed."}

    return router
