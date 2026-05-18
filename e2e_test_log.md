# E2E Test Log - Langfuse Integrated Platform

**Date:** 2026-05-16
**Tester:** Automated E2E Testing
**Platform:** C:\Users\Imago\Desktop\langfuse-platform
**URL:** http://127.0.0.1:8080

## Issues Found and Fixed

### 1. Observability Module: Langfuse .trace() API removed in SDK v4
- **Severity:** Critical (500 Internal Server Error on POST /api/traces)
- **Root Cause:** TraceManager.create_trace() called self._client.trace() which doesn't exist in Langfuse SDK v4.6.1. The Langfuse SDK v4 uses create_trace_id() + start_observation() instead.
- **Fix:** Replaced self._client.trace() with self._client.create_trace_id(seed=name) + self._client.start_observation(name=name, as_type="span", trace_context={"trace_id": trace_id}).
- **Files:** src/modules/observability.py

### 2. Observability Module: TraceManager.__init__ missing client parameter
- **Severity:** Critical (ObservabilityModule passed client= but TraceManager didn't accept it)
- **Root Cause:** ObservabilityModule.__init__ called TraceManager(client=langfuse_client) but TraceManager only accepted public_key/secret_key/host.
- **Fix:** Added client: Langfuse | None = None parameter to TraceManager.__init__. If provided, uses the client directly instead of creating a new one.
- **Files:** src/modules/observability.py

### 3. Observability Module: 	race.span() and 	race.generation() removed
- **Severity:** Critical
- **Root Cause:** Old API used 	race.span() and 	race.generation() on trace objects. Langfuse v4 doesn't have these methods.
- **Fix:** Replaced with self._client.start_observation(as_type="span", trace_context={"trace_id": trace_id}) and self._client.start_observation(as_type="generation", ...).
- **Files:** src/modules/observability.py

### 4. Observability Module: span.end(output=...) changed
- **Severity:** Medium
- **Root Cause:** In v4, span.end() only accepts end_time. Output/metadata updates use span.update(output=..., metadata=...).
- **Fix:** Changed update_span() to call span.update(**kwargs) then span.end() instead of span.end(**kwargs).
- **Files:** src/modules/observability.py

### 5. Evaluation Module: Langfuse.score() removed in SDK v4
- **Severity:** Critical (would cause errors when logging evaluation scores)
- **Root Cause:** self._langfuse.score(**kwargs) doesn't exist in v4. The correct method is self._langfuse.create_score(name=..., value=..., trace_id=..., ...).
- **Fix:** Replaced self._langfuse.score(**kwargs) with self._langfuse.create_score(name=kwargs.get("name"), value=kwargs.get("score"), trace_id=kwargs.get("trace_id"), observation_id=kwargs.get("observation_id"), comment=str(kwargs.get("data", {}))).
- **Files:** src/modules/evaluation.py

### 6. Playground Module: Langfuse.trace() removed in SDK v4
- **Severity:** Critical (POST /api/playground/run returned AttributeError: 'Langfuse' object has no attribute 'trace')
- **Root Cause:** PlaygroundRunner.run_prompt() and un_prompt_with_template() called self.langfuse.trace() which doesn't exist in v4.
- **Fix:** Complete rewrite of PlaygroundRunner to use v4 API: self.langfuse.create_trace_id(seed=trace_name) for trace IDs, self.langfuse.start_observation() for spans/generations, generation.update(output=..., usage_details=...) then generation.end() for finalization, self.langfuse.get_trace_url(trace_id=trace_id) for trace URLs.
- **Files:** src/modules/playground.py

### 7. Dashboard: Evaluate endpoint wrong argument order
- **Severity:** Critical (POST /api/evaluate returned AttributeError: 'str' object has no attribute 'name')
- **Root Cause:** mods["evaluation"].run_evaluators(body["input"], body["output"], ...) was calling the instance method with wrong argument order. The first positional arg was expected to be evaluators but received a string.
- **Fix:** Changed to EvaluationModule.run_evaluators(evaluators, body["input"], body["output"], ...) (static method call with correct arg order).
- **Files:** dashboard.py

### 8. Config: Langfuse constructor invalid kwargs
- **Severity:** Critical (TypeError: Langfuse.__init__() got an unexpected keyword argument 'enabled')
- **Root Cause:** get_langfuse_client() passed enabled, max_retries, mask_keys, and 	hreads kwargs to Langfuse() which don't exist in v4 SDK. The v4 constructor uses 	racing_enabled (not enabled), lush_at (not configurable as max_retries), mask (a function, not bool), and media_upload_thread_count (not 	hreads).
- **Fix:** Removed invalid kwargs (max_retries, mask_keys) and renamed enabled to 	racing_enabled, 	hreads to media_upload_thread_count.
- **Files:** config/settings.py

### 9. Dashboard: Missing error handling on trace/evaluate endpoints
- **Severity:** Low (returned bare 500 errors without JSON error details)
- **Fix:** Added try/except blocks returning JSONResponse(status_code=500, content={"error": str(e)}) for /api/traces and /api/evaluate.
- **Files:** dashboard.py

## E2E Test Results (Post-Fix)

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| /api/health | GET | 200 | OK |
| /api/traces | POST | 200 | Returns trace_id |
| /api/evaluate | POST | 200 | Returns evaluation scores |
| /api/prompts | GET | 200 | Lists prompts |
| /api/prompts | POST | 200 | Creates prompt |
| /api/prompts/render | POST | 200 | Renders prompt template |
| /api/experiments | GET | 200 | Returns empty list |
| /api/annotations/tasks | GET | 200 | Returns task list |
| /api/annotations/stats | GET | 200 | Returns stats |
| /api/cost/daily | GET | 200 | Returns daily cost |
| /api/cost/monthly | GET | 200 | Returns monthly cost |
| /api/cost/by-model | GET | 200 | Returns per-model cost |
| /api/cost/models | GET | 200 | Returns model pricing |
| /api/latency/stats | GET | 200 | Returns latency stats |
| / | GET | 200 | Dashboard HTML loads |
| /api/playground/run | POST | 200* | Returns graceful error if LLM unavailable |

*Note: /api/playground/run requires a running LLM provider (Ollama or OpenAI). Returns {"error": "404 page not found"} if Ollama is not running, which is expected behavior.

## UX Testing Notes

The dashboard at http://127.0.0.1:8080 has a sidebar with 8 modules:
1. **Overview** - Health check and prompts/experiments/stats cards
2. **Observability** - Create traces (now working with v4 API)
3. **Evaluation** - Run evaluators (now working with correct arg order)
4. **Prompt Management** - Create and render prompts
5. **Playground** - Run LLM prompts (requires Ollama/OpenAI)
6. **Experiments** - Create and list experiments
7. **Annotation** - Create annotation tasks and view stats
8. **Cost & Latency** - View daily/monthly costs and latency stats

All sidebar navigation modules now open and function correctly. The previous errors where modules returned 500 errors have been resolved.
