"""
Resend (transactional email) — single-purpose helper for password-reset
emails. Stays fully optional: when RESEND_API_KEY is missing/blank, calls
are no-ops that log + return False so the auth endpoint can still respond
successfully without leaking the misconfiguration to clients.

Doc: https://resend.com/docs/api-reference/emails/send-email
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("prayers_loft.email")

RESEND_API_URL = "https://api.resend.com/emails"


def _is_enabled() -> bool:
    return bool(os.environ.get("RESEND_API_KEY", "").strip())


def _from_address() -> str:
    return os.environ.get("RESEND_FROM", "Prayers Loft <onboarding@resend.dev>").strip() or (
        "Prayers Loft <onboarding@resend.dev>"
    )


def _public_url() -> str:
    return os.environ.get("APP_PUBLIC_URL", "https://prayers-loft.preview.emergentagent.com").rstrip("/")


def _reset_html(reset_url: str) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Reset your password — Prayers Loft</title>
</head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#E7EAF3;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0e1a;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#141a2e;border-radius:20px;padding:32px 28px;border:1px solid rgba(200,169,107,0.18);">
        <tr><td>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#C8A96B;letter-spacing:0.5px;margin-bottom:18px;">Prayers Loft</div>
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;color:#E7EAF3;margin:0 0 16px 0;">Reset your password</h1>
          <p style="margin:0 0 18px 0;font-size:15px;line-height:23px;color:#B4BACB;">We received a request to reset your Prayers Loft password. Tap the button below to choose a new one. This link expires in 30 minutes.</p>
          <p style="margin:24px 0;"><a href="{reset_url}" style="display:inline-block;background:#C8A96B;color:#0c1024;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:14px;font-size:15px;">Reset password</a></p>
          <p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:#8A92A6;">If the button doesn't work, paste this link into your browser:</p>
          <p style="margin:0 0 18px 0;font-size:12px;line-height:18px;word-break:break-all;color:#8A92A6;">{reset_url}</p>
          <p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#6B7280;">If you didn't request this, you can safely ignore this email — your password will stay unchanged.</p>
        </td></tr>
      </table>
      <p style="margin:18px 0 0 0;font-size:11px;color:#6B7280;">A quiet place to pray, reflect, and remember.</p>
    </td></tr>
  </table>
</body>
</html>"""


async def send_password_reset_email(to_email: str, reset_token: str) -> bool:
    """Send the password-reset email. Returns True on 2xx, False otherwise.
    Never raises. Logs at warning level when disabled or on failure.
    """
    if not _is_enabled():
        logger.info("resend: API key missing, skipping send (would have emailed %s)", to_email)
        return False
    reset_url = f"{_public_url()}/reset-password?token={reset_token}"
    html = _reset_html(reset_url)
    payload = {
        "from": _from_address(),
        "to": [to_email],
        "subject": "Reset your Prayers Loft password",
        "html": html,
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client_:
            r = await client_.post(
                RESEND_API_URL,
                headers={
                    "Authorization": f"Bearer {os.environ['RESEND_API_KEY']}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if r.status_code // 100 == 2:
            return True
        logger.warning("resend: send failed status=%s body=%s", r.status_code, r.text[:300])
        return False
    except Exception as e:
        logger.warning("resend: send error: %r", e)
        return False
