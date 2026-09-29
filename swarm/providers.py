import json
import os
import threading
from datetime import datetime, timezone
from dataclasses import dataclass

from .models import GEMINI_MODEL, OPENAI_MODEL
from .response_contract import response_schema

RATES = {"gemini": (0.25, 1.50), "openai": (4.0, 20.0)}
MAX_OUTPUT = 2400
# Reserve for the worker model's full documented output capacity, including
# thinking, even though the request has a much smaller generation limit.
GEMINI_BILLED_OUTPUT_RESERVE = 65536


@dataclass
class ProviderResult:
    text: str
    input_tokens: int
    output_tokens: int
    returned_model: str
    response_id: str | None = None

    def cost(self, provider):
        if provider == "local":
            return 0.0
        inp, out = RATES[provider]
        return (self.input_tokens * inp + self.output_tokens * out) / 1_000_000


class ProviderFailure(RuntimeError):
    def __init__(self, message, definitely_unbilled=False):
        super().__init__(message)
        self.definitely_unbilled = definitely_unbilled


def provider_failure(provider, exc, *, metadata_only=False):
    """Classify provider errors without returning raw bodies, prompts or keys."""
    code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    label = "Gemini" if provider == "gemini" else "OpenAI"
    if code in (400, 401, 403, 404, 422, 429):
        descriptions = {
            400: "The request format was rejected. No automatic retry was made.",
            401: "The API key was rejected. Update it in Connections.",
            403: "This API account does not have access to the selected model or service.",
            404: "The configured model is unavailable for this API account.",
            422: "The response schema was rejected.",
            429: "The provider's quota was reached. Check its billing and rate limits.",
        }
        description = descriptions[code]
        # Only select application-owned messages. Never echo the SDK's body.
        detail = str(getattr(exc, "message", "") or "").lower()
        if code == 400:
            if "api key not valid" in detail or "api_key_invalid" in detail or "api key expired" in detail:
                description = descriptions[401]
            elif any(term in detail for term in ("too many states", "too complex", "complexity")):
                description = "The response schema exceeded the provider's complexity limit. Simplify the generation contract."
            elif any(term in detail for term in ("response_schema", "responseschema", "responsejsonschema", "additional_properties", "schema")):
                description = "The structured-output schema was rejected. Check the Gemini request format."
            elif "thinking" in detail:
                description = "The thinking setting was rejected for this model."
        return ProviderFailure(f"{label} (HTTP {code}): {description}", True)
    if metadata_only:
        return ProviderFailure(f"{label}: model availability could not be checked. No generation calls were sent.", True)
    return ProviderFailure(f"{label}: the call did not finish reliably. Its reservation is retained; no automatic retry was made.")


class Providers:
    def __init__(self):
        from .local import LocalProvider
        self.local = LocalProvider()
        self.lock = threading.RLock()
        allow_environment = os.environ.get("SIGIL_SWARM_ALLOW_ENV_KEYS") == "1"
        openai_key = os.environ.get("OPENAI_API_KEY", "") if allow_environment else ""
        gemini_key = (os.environ.get("GEMINI_API_KEY", "") or os.environ.get("GOOGLE_API_KEY", "")) if allow_environment else ""
        self.keys = {
            "openai": openai_key,
            "gemini": gemini_key,
        }
        self.verified = {"openai": False, "gemini": False}
        self.verified_at = {"openai": None, "gemini": None}
        self.sources = {
            "openai": "environment" if openai_key else None,
            "gemini": "environment" if gemini_key else None,
        }

    def public_status(self):
        with self.lock:
            return {
                p: dict(configured=bool(self.keys[p]), verified=self.verified[p],
                        source=self.sources[p], verified_at=self.verified_at[p],
                        model=GEMINI_MODEL if p == "gemini" else OPENAI_MODEL)
                for p in self.keys
            }

    def configure(self, **keys):
        with self.lock:
            for p in self.keys:
                value = keys.get(p + "_api_key")
                if value is not None and value.strip():
                    if any(ch.isspace() for ch in value.strip()):
                        raise ValueError("An API key cannot contain spaces or line breaks.")
                    self.keys[p] = value.strip()
                    self.verified[p] = False
                    self.verified_at[p] = None
                    self.sources[p] = "session"
            return self.public_status()

    def disconnect(self, provider):
        with self.lock:
            self.keys[provider] = ""
            self.verified[provider] = False
            self.verified_at[provider] = None
            self.sources[provider] = None
            return self.public_status()

    def check_gemini_model(self):
        """Read model metadata before any paid planning, without generating text."""
        from google import genai
        from google.genai import types

        with self.lock:
            key = self.keys["gemini"]
        if not key:
            raise ProviderFailure("Connect Gemini in Connections before starting API work.", True)
        try:
            with genai.Client(api_key=key, vertexai=False, http_options=types.HttpOptions(
                base_url="https://generativelanguage.googleapis.com", timeout=10000,
                retry_options=types.HttpRetryOptions(attempts=1),
            )) as client:
                model = client.models.get(model=GEMINI_MODEL)
            name = (model.name or "").removeprefix("models/")
            if name != GEMINI_MODEL and not name.startswith(GEMINI_MODEL + "-"):
                raise ProviderFailure("Gemini returned an unexpected model in its availability check. No generation calls were sent.", True)
            if "generateContent" not in (model.supported_actions or []):
                raise ProviderFailure("Gemini does not list text generation for this model. No generation calls were sent.", True)
        except ProviderFailure:
            raise
        except Exception as exc:
            raise provider_failure("gemini", exc, metadata_only=True) from None

    def reservation(self, provider, system, prompt, schema):
        if provider == "local":
            return 0.0
        # One byte per input token is deliberately conservative for text-only
        # prompts; include the complete schema and substantial framing overhead.
        input_bound = len((system + prompt + json.dumps(response_schema(schema, prompt))).encode("utf-8")) + 8192
        if input_bound > 100000:
            raise ValueError("This task's context is too large. Start a narrower mission.")
        output_bound = GEMINI_BILLED_OUTPUT_RESERVE if provider == "gemini" else MAX_OUTPUT
        inp, out = RATES[provider]
        return round((input_bound * inp + output_bound * out) / 1_000_000 + 0.002, 6)

    def run(self, provider, system, prompt, schema):
        if provider == "local":
            return self.local.run(system, prompt, schema)
        with self.lock:
            key = self.keys.get(provider)
        if not key:
            raise ProviderFailure(f"Connect {provider.title()} in Connections before starting API work.", True)
        try:
            if provider == "openai":
                from openai import OpenAI

                # Explicit endpoint and no SDK retries: every model call must have
                # exactly one recorded budget reservation.
                with OpenAI(api_key=key, base_url="https://api.openai.com/v1",
                            max_retries=0, timeout=90.0) as client:
                    response = client.responses.create(
                        model=OPENAI_MODEL, store=False, max_output_tokens=MAX_OUTPUT,
                        reasoning={"effort": "low"},
                        input=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                        text={"format": {
                            "type": "json_schema", "name": schema.__name__,
                            "schema": response_schema(schema, prompt), "strict": True,
                        }},
                    )
                    usage = response.usage
                    if usage is None or usage.input_tokens is None or usage.output_tokens is None:
                        raise ProviderFailure("OpenAI returned no usage record. Billing needs reconciliation.")
                    result = ProviderResult(
                        response.output_text or "", usage.input_tokens, usage.output_tokens,
                        response.model, response.id,
                    )
            else:
                from google import genai
                from google.genai import types

                client = genai.Client(
                    api_key=key, vertexai=False,
                    http_options=types.HttpOptions(
                        base_url="https://generativelanguage.googleapis.com",
                        timeout=90000, retry_options=types.HttpRetryOptions(attempts=1),
                    ),
                )
                try:
                    response = client.models.generate_content(
                        model=GEMINI_MODEL, contents=prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=system, candidate_count=1,
                            max_output_tokens=MAX_OUTPUT,
                            # Pydantic emits JSON Schema (including additionalProperties),
                            # not the older OpenAPI-style responseSchema protocol.
                            response_mime_type="application/json",
                            response_json_schema=response_schema(schema, prompt),
                            thinking_config=types.ThinkingConfig(thinking_level="minimal"),
                            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                        ),
                    )
                    usage = response.usage_metadata
                    if usage is None or usage.prompt_token_count is None or usage.candidates_token_count is None:
                        raise ProviderFailure("Gemini returned no usage record. Billing needs reconciliation.")
                    result = ProviderResult(
                        response.text or "", usage.prompt_token_count,
                        usage.candidates_token_count + (usage.thoughts_token_count or 0),
                        response.model_version or "",
                        getattr(response, "response_id", None),
                    )
                finally:
                    client.close()
            with self.lock:
                self.verified[provider] = True
                self.verified_at[provider] = datetime.now(timezone.utc).isoformat()
            return result
        except ProviderFailure:
            with self.lock:
                self.verified[provider] = False
            raise
        except Exception as exc:
            with self.lock:
                self.verified[provider] = False
            raise provider_failure(provider, exc) from None
