# Load-test results

Each k6 scenario's `handleSummary` writes a timestamped Markdown report and JSON summary into `loadtest/results/`. Commit those generated reports after recording the machine, branch, commit, endpoint, cache mode, and workload. Use identical settings for before/after comparisons.

| Scenario | Result report | Comparison / notes |
|---|---|---|
| Gateway throughput and p95 | Pending local run: `gateway.js` | Same machine, VUs, duration, endpoint |
| Cache off vs on | Pending route-specific run: `cache.js` | Same test account/data and request; cache mode recorded |
| Error rate / rate limiting | Pending local run: `rate-limit.js` | Same workload before and after limiter change |
| LLM cost / cache hit rate | Pending; protected `/metrics` plus provider token usage | Record model, prompt, sample size, repeated vs new resume |
| Streaming time to first token | Pending; collect server timing logs for 20 interviews | Compare SSE against full response, same prompt/model |
| Resume score consistency / injection block rate | See [`eval/README.md`](../eval/README.md); run `npm run eval:resume -- --runs 5 --prompt v1` | Add v1/v2 result paths and attack-set size/success criteria |
| Queue recovery | Pending controlled worker-crash exercise | Count queued, completed, failed, and lost jobs |
| Double-spend | Pending 100 parallel deductions against disposable test balance | Record ledger state and old/new design |
| Event lag | Pending: `npm run benchmark:lag --workspace=progress -- --rate=100 --count=1000` | Results are not yet recorded |
| Tests / CI | GitHub Actions runs are linked in README | Keep branch, test count, and duration with the CI run |

Do not run heavy tests against the free Cloud Run, Atlas, or hosted Redis tiers. The current file intentionally contains no guessed performance or cost values.
