"""Local inference only. No cloud fallback, proxy inheritance, or redirects."""
import json
import threading

import httpx
from pydantic import ValidationError

from .providers import ProviderFailure, ProviderResult

LOCAL_URL = "http://127.0.0.1:1234/v1"
LOCAL_MODEL = "sigil-local"


class LocalProvider:
    def __init__(self):
        self.lock = threading.Lock()
        self.verified = False

    def status(self):
        try:
            with httpx.Client(trust_env=False, follow_redirects=False, timeout=2) as client:
                response = client.get(LOCAL_URL + "/models")
                response.raise_for_status()
                available = any(m.get("id") == LOCAL_MODEL for m in response.json().get("data", []))
        except Exception:
            available = False
        return {"configured": available, "verified": available and self.verified,
                "model": LOCAL_MODEL, "provider": "LM Studio", "endpoint": LOCAL_URL,
                "note": "Local inference; no model API fee. Electricity is not included."}

    def run(self, system, prompt, schema):
        if len((system + prompt + json.dumps(schema.model_json_schema())).encode("utf-8")) > 85000:
            raise ProviderFailure("Local context is too large; split this assignment.", True)
        with self.lock:
            try:
                with httpx.Client(trust_env=False, follow_redirects=False, timeout=240) as client:
                    response = client.post(LOCAL_URL + "/chat/completions", json={
                        "model": LOCAL_MODEL,
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                        "response_format": {"type": "json_schema", "json_schema": {
                            "name": schema.__name__, "strict": True, "schema": schema.model_json_schema()}},
                        "temperature": 0.1, "max_tokens": 4000, "stream": False,
                    })
                    response.raise_for_status()
                    data = response.json()
                if data.get("model") != LOCAL_MODEL:
                    raise ValueError("Unexpected model")
                choice = data["choices"][0]
                if choice.get("finish_reason") != "stop":
                    raise ValueError("Incomplete generation")
                content = choice["message"]["content"]
                schema.model_validate_json(content)
                usage = data["usage"]
                counts = [usage["prompt_tokens"], usage["completion_tokens"]]
                if any(type(n) is not int or n < 0 for n in counts):
                    raise ValueError("Invalid usage")
                self.verified = True
                return ProviderResult(content, *counts, data["model"], data.get("id"))
            except ValidationError as exc:
                self.verified = False
                codes = sorted({e['type'] for e in exc.errors(include_input=False, include_context=False, include_url=False)})
                raise ProviderFailure("Local output failed schema validation (" + ", ".join(codes) + "). No automatic retry was used.", True) from None
            except httpx.TimeoutException:
                self.verified = False
                raise ProviderFailure("Local generation timed out. No cloud fallback or automatic retry was used.", True) from None
            except Exception:
                self.verified = False
                raise ProviderFailure("Local generation failed, timed out, or returned invalid output. No cloud fallback or automatic retry was used.", True) from None
