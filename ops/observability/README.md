# Metrics and dashboards

Each internal backend service exposes Prometheus metrics on `/metrics`. The
service ports remain private to the Compose network; the public gateway is not a
Prometheus scrape target. Prometheus and Grafana are available in the optional
`observability` profile.

Start the stack and observability tools:

```sh
docker compose up -d --build
docker compose --profile observability up -d prometheus grafana
```

Open Prometheus at <http://localhost:9090> and Grafana at
<http://localhost:3000>. Grafana defaults to `admin` / `change-me`; override
`GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` in your local `.env` before
exposing the service beyond localhost. The Prometheus data source and FresherAI
Overview dashboard are provisioned from `ops/grafana/`.

To generate a short request sample that moves the HTTP panels:

```sh
docker compose --profile observability run --rm k6
```

Model costs are estimates sourced from the token price table in
`backend/shared/observability/llmPricing.js`. Token counts use provider-reported
usage when available and a clearly labeled chars/4 estimate otherwise. Values
are process-lifetime counters; Prometheus restart resets its stored series only
after its retention or volume is removed, while service restarts reset their
process counters.
