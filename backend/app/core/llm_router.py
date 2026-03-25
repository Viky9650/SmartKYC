"""
LLM Router — supports Gemini (default), Anthropic, OpenAI
Gemini Vision is used for document image extraction.
"""
import re
import io
import json
import base64
import logging
from typing import Optional
from app.core.config import settings

logger = logging.getLogger(__name__)


class LLMRouter:
    """Text completion — routes to configured provider."""

    async def complete(
        self,
        prompt: str,
        system: Optional[str] = None,
        json_mode: bool = False,
        max_tokens: int = 2000,
    ) -> str:
        provider = settings.LLM_PROVIDER.lower()
        if provider == "gemini":
            return await self._gemini(prompt, system, max_tokens)
        elif provider == "anthropic":
            return await self._anthropic(prompt, system, max_tokens)
        elif provider == "openai":
            return await self._openai(prompt, system, json_mode, max_tokens)
        else:
            logger.warning(f"Unknown provider '{provider}', falling back to Gemini")
            return await self._gemini(prompt, system, max_tokens)

    # ── Gemini ────────────────────────────────────────────────────────────────
    async def _gemini(self, prompt: str, system: Optional[str], max_tokens: int) -> str:
        if not settings.GEMINI_API_KEY:
            return self._fallback_response(prompt)
        try:
            from google import genai
            from google.genai import types
            client = genai.Client(api_key=settings.GEMINI_API_KEY)
            full = f"{system}\n\n{prompt}" if system else prompt
            resp = await client.aio.models.generate_content(
                model=settings.GEMINI_MODEL,
                contents=full,
                config=types.GenerateContentConfig(
                    max_output_tokens=max_tokens,
                    temperature=0.1,
                ),
            )
            return resp.text
        except Exception as e:
            logger.error(f"Gemini text completion failed: {e}")
            return self._fallback_response(prompt)

    # ── Gemini Vision (image + text) ──────────────────────────────────────────
    async def gemini_vision(
        self,
        image_bytes: bytes,
        mime_type: str,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: int = 2000,
    ) -> str:
        """Send an image + text prompt to Gemini Vision."""
        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY not configured")
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.GEMINI_API_KEY)
        full_prompt = f"{system}\n\n{prompt}" if system else prompt

        image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        text_part  = types.Part.from_text(text=full_prompt)

        resp = await client.aio.models.generate_content(
            model=settings.GEMINI_VISION_MODEL,
            contents=types.Content(parts=[image_part, text_part]),
            config=types.GenerateContentConfig(
                max_output_tokens=max_tokens,
                temperature=0.1,
            ),
        )
        return resp.text

    # ── Anthropic ─────────────────────────────────────────────────────────────
    async def _anthropic(self, prompt: str, system: Optional[str], max_tokens: int) -> str:
        if not settings.ANTHROPIC_API_KEY:
            return self._fallback_response(prompt)
        import httpx
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": settings.ANTHROPIC_API_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": settings.ANTHROPIC_MODEL,
                    "max_tokens": max_tokens,
                    "system": system or "You are a KYC/AML compliance AI. Return valid JSON only.",
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            return resp.json()["content"][0]["text"]

    # ── OpenAI ────────────────────────────────────────────────────────────────
    async def _openai(self, prompt: str, system: Optional[str], json_mode: bool, max_tokens: int) -> str:
        if not settings.OPENAI_API_KEY:
            return self._fallback_response(prompt)
        import httpx
        payload: dict = {
            "model": settings.OPENAI_MODEL,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system or "You are a KYC/AML compliance AI."},
                {"role": "user",   "content": prompt},
            ],
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                json=payload,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

    # ── Fallback ──────────────────────────────────────────────────────────────
    def _fallback_response(self, prompt: str) -> str:
        logger.warning("No LLM API key configured — using deterministic fallback")
        return json.dumps({
            "investigation_plan": [
                "identity_verification", "sanctions_screening",
                "pep_check", "adverse_media_scan",
            ],
            "reasoning": "Default plan — no LLM key configured.",
            "risk_indicators": ["Manual review required"],
            "priority_level": "MEDIUM",
            "estimated_risk": 40,
        })


llm = LLMRouter()
