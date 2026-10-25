# Local load-test scenarios

These k6 scripts are designed for local Compose or a short-lived test VM. By default, `common.js` rejects non-local URLs. Never target the free Cloud Run, Atlas, or Redis tiers with heavy load tests.

## Gateway throughput and latency

Start the stack (`docker compose up --build`), install k6 locally, then run:

```bash
SCENARIO=gateway-smoke VUS=10 DURATION=30s MACHINE_SPECS="CPU/RAM/OS" GIT_BRANCH="$(git branch --show-current)" GIT_COMMIT="$(git rev-parse --short HEAD)" k6 run loadtest/gateway.js
```

This hits gateway `/health`, which checks Redis. It does not model authenticated application traffic or LLM cost. `handleSummary` emits timestamped JSON and Markdown into `loadtest/results/`.

## Cache comparison

Choose an authenticated, repeatable request that does not create a new record or trigger a charge. Supply its route and stable payload. Run the same script and machine twice, setting `CACHE_MODE=off` and `CACHE_MODE=on`; ensure the actual server cache is configured accordingly and note how it was disabled/enabled. Example:

```bash
BASE_URL=http://localhost:8000 ENDPOINT=/api/career/match METHOD=POST BODY='{"resumeId":"TEST_ID","jobText":"synthetic repeatable test job"}' AUTH_TOKEN="$TEST_TOKEN" CACHE_MODE=off VUS=1 DURATION=10s k6 run loadtest/cache.js
```

The example may incur feature charges and requires a seeded test user/resume; use only disposable local data and a test balance. For read-only requests, use GET. The script records latency/errors; collect Redis cache counters separately from protected service metrics.

## Rate-limiter behavior

Use a dedicated test account and a harmless authenticated endpoint. The default `/api/me` does not exercise the AI limiter; set `ENDPOINT` to an AI route only if you have a non-billable test request. A burst may be rejected with HTTP 429 by design. Do not use a route that calls a paid model unless the request volume is tightly bounded.

```bash
ENDPOINT=/api/me AUTH_TOKEN="$TEST_TOKEN" VUS=20 DURATION=30s k6 run loadtest/rate-limit.js
```

## Generated results

Every run creates `loadtest/results/<UTC>-<scenario>.json` and `.md`. Reports include request count, throughput, p95 response duration, error/check rates, endpoint, workload, cache mode, branch, commit, and machine-spec field. Populate `MACHINE_SPECS`; generated reports explicitly say if it is missing. For valid before/after comparisons, hold machine, service configuration, dataset, request, cache state, and workload constant. Preserve both generated report files and link them from [`RESULTS.md`](RESULTS.md) and the README.

Additional measurement protocols for SSE time-to-first-token, LLM token/cost counters, queue crash recovery, parallel coin deductions, and event lag are listed in [`RESULTS.md`](RESULTS.md). Use local disposable data, capture raw output/logs, and report unchanged or worse results honestly.
