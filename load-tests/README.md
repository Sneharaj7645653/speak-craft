# SpeakCraft local API load tests

These k6 scripts are restricted to `localhost`/`127.0.0.1`. They use the
existing synthetic `bench0001`–`bench0300` accounts and a single reusable local
instructor account; no production URL or production key is read from `.env.local`.
The harness gets the local Supabase URL and keys from `supabase status`.

## Setup and execution

```bash
brew install k6
npm run db:start
npm run db:seed
npm run loadtest:setup
npm run loadtest:smoke
npm run loadtest:api
```

`db:seed` resets only the synthetic `bench%@local.test` users and benchmark
assignments before rebuilding the documented 300-student fixture. Do not use
this command against a non-local database.

`loadtest:api` builds and starts the Next.js production server on
`http://127.0.0.1:3100`, performs one warm-up per endpoint, checks heartbeat
results against PostgreSQL, runs the same-student race and cap/duplicate/ended
session correctness checks, then runs three repetitions at 1, 10, 25, 50, and
100 VUs for heartbeat, streak, instructor metrics, and assignment distribution.
Each load wave ramps VUs for two seconds and sends one request per VU at a common
wave time. Assignment test rows and heartbeat fixtures are checked and removed
between runs to keep the seeded dataset stable.

Raw k6 NDJSON and per-run summaries are saved in
`load-tests/results/run-*/`. The aggregated `api-load-results.json` in that
directory includes per-run and median-by-concurrency results. `latest.json`
points to the latest completed run.

The AI coaching endpoint is intentionally not called by this harness: it streams
from external LLM providers and could incur cost or transmit prompt data outside
the local machine. Provider latency/fallback remains unmeasured here.

Cleanup for interrupted runs:

```bash
npm run loadtest:cleanup
```
