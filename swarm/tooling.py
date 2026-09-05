import hashlib
import math

from .providers import ProviderFailure
from .search import SEARCH_MODEL, SEARCH_RESERVATION, paper_search, validate_query, web_search
from .sources import fetch_source
from .store import BudgetError, now, uid


class MissionTools:
    def __init__(self, store, providers, studio):
        self.store, self.providers, self.studio = store, providers, studio

    def execute(self, mission_id, agent_id, request, check_stop, *, task_id=None):
        check_stop()
        query_error = None
        if request.tool in ("web_search", "paper_search"):
            try:
                validate_query(request.query)
                for content in getattr(self.studio, "files", {}).values():
                    if any(len(line.strip()) >= 40 and line.strip() in request.query for line in content.splitlines()):
                        raise ValueError("Search a public concept, not a copied project excerpt.")
            except ValueError as exc:
                query_error = str(exc)
        with self.store.lock:
            data = self.store.get(mission_id)
            records = data.setdefault("tool_results", [])
            if len(records) >= 32:
                self.store.message(mission_id, "system", agent_id,
                                   "This mission reached its 32-tool limit. Your tool request was not executed; finish from existing evidence.", "tool_result")
                return {"status": "blocked", "summary": "This mission reached its 32-tool limit."}
            record = dict(id=uid("tool"), task_id=task_id, agent_id=agent_id, tool=request.tool, status="running",
                          path=request.path, query="[withheld: invalid public search query]" if query_error else request.query,
                          created_at=now(), summary="Tool is running.", result={})
            prior_count = sum(r["tool"] == request.tool for r in records)
            records.append(record)
            self.store.save(data)
        try:
            if query_error:
                raise ValueError(query_error)
            if request.tool in ("web_search", "paper_search", "fetch_page"):
                with self.store.lock:
                    source_exposed = any(
                        item["agent_id"] == agent_id
                        and item.get("tool") in ("read_file", "search_code", "draft_file")
                        and item.get("status") == "completed"
                        for item in self.store.get(mission_id).get("tool_results", [])
                    )
                if source_exposed:
                    raise ValueError(
                        "This role already received private project source in this mission. "
                        "Route external research to a role that has not read repository text."
                    )
            if request.tool == "read_file":
                result = self.studio.read(request.path, start=request.start)
            elif request.tool == "search_code":
                result = self.studio.search(request.query)
            elif request.tool == "draft_file":
                if agent_id not in ("engineering", "quant"):
                    raise ValueError("Ask the engineer or quant to draft a change; this role can inspect and review it.")
                if prior_count >= 8:
                    raise ValueError("This mission reached its eight-draft limit.")
                result = self.studio.draft(request.path, request.content, agent_id)
                with self.store.lock:
                    self.store.get(mission_id).setdefault("drafts", []).append(result)
                    self.store.save(self.store.get(mission_id))
            elif request.tool in ("check_syntax", "run_tests"):
                drafts = self.store.snapshot(mission_id).get("drafts", [])
                if request.tool == "check_syntax":
                    result = self.studio.syntax(drafts)
                else:
                    if prior_count >= 2:
                        raise ValueError("This mission reached its two isolated test-run limit.")
                    result = self.studio.run_tests(drafts, request.path)
                effective_drafts = {d["path"]: d for d in drafts}
                result["checked_drafts"] = [{"id": d["id"], "path": d["path"],
                    "sha256": hashlib.sha256(d["content"].encode("utf-8")).hexdigest()} for d in effective_drafts.values()]
            elif request.tool == "web_search":
                if prior_count >= 2:
                    raise ValueError("This mission reached its two web-search limit. Use existing results or free paper search.")
                result = self._web_search(mission_id, agent_id, request.query, check_stop, task_id=task_id)
            elif request.tool == "paper_search":
                if prior_count >= 4:
                    raise ValueError("This mission reached its four paper-search limit.")
                result = paper_search(request.query)
            elif request.tool == "fetch_page":
                if prior_count >= 6:
                    raise ValueError("This mission reached its six page-fetch limit.")
                result = fetch_source(request.query)
            else:
                raise ValueError("This tool is not available.")
            status = result.get("status", "completed")
            if status in ("no_search", "not_checked"):
                status = "blocked"
            elif status == "timed_out":
                status = "failed"
            elif status not in ("failed", "blocked"):
                status = "completed"
            summary = f"{request.tool}: {status}. " + (request.path or request.query)[:180]
            record.update(status=status, result=result, summary=summary)
        except (ValueError, BudgetError) as exc:
            record.update(status="blocked", summary=str(exc), result={"status": "blocked", "reason": str(exc)})
        except ProviderFailure as exc:
            record.update(status="failed", summary=str(exc), result={"status": "failed", "reason": str(exc)})
            raise
        except Exception:
            record.update(status="failed", summary="This tool could not complete. Its result is unavailable.",
                          result={"status": "failed", "reason": "Tool unavailable or request failed; no result was verified."})
        finally:
            record["finished_at"] = now()
            with self.store.lock:
                self.store.save(self.store.get(mission_id))
            self.store.message(mission_id, "system", agent_id, record["summary"], "tool_result")
        return record

    def _web_search(self, mission_id, agent_id, query, check_stop, *, task_id=None):
        if not query.strip():
            raise ValueError("Write a specific public web-search query.")
        check_stop()
        call_id = self.store.reserve(
            mission_id, agent_id, "openai", SEARCH_MODEL, SEARCH_RESERVATION,
            task_id=task_id,
        )
        try:
            try:
                check_stop()
            except Exception:
                self.store.settle(call_id, cost=0, error="Stopped before search dispatch")
                raise
            result = web_search(self.providers, query)
        except ProviderFailure as exc:
            self.store.settle(call_id, cost=0 if exc.definitely_unbilled else None, error=str(exc))
            raise
        except Exception:
            # A stopped-before-dispatch call is already settled; all other failures
            # retain their allowance instead of silently redispatching.
            with self.store.lock:
                call = next(c for c in self.store.ledger if c["id"] == call_id)
                if call["status"] == "reserved":
                    self.store.settle(call_id, error="Web search failed unexpectedly; billing uncertain.")
            raise
        try:
            model, usage, cost = result["model"], result["usage"], result["estimated_cost_usd"]
            valid = (isinstance(model, str) and (model == SEARCH_MODEL or model.startswith(SEARCH_MODEL + "-"))
                     and usage["search_calls"] in (0, 1) and math.isfinite(cost) and cost >= 0
                     and isinstance(result["response_id"], str) and bool(result["response_id"]))
        except (KeyError, TypeError, ValueError):
            valid = False
        if not valid:
            self.store.settle(call_id,
                              error="Search model or tool count was unexpected; billing needs reconciliation.")
            raise ProviderFailure("Web search provenance needs reconciliation; no fallback was used.")
        self.store.settle(call_id, cost=cost, usage=usage,
                          returned_model=model, response_id=result["response_id"])
        return result
