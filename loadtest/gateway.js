// Setup: local `docker compose up --build`; same machine for every comparison.
// Smoke/throughput baseline for the gateway health endpoint (no auth or LLM calls).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { baseUrl, report } from './common.js';

export const options = { vus: Number(__ENV.VUS || 10), duration: __ENV.DURATION || '30s', thresholds: {} };
export default function () {
  const response = http.get(`${baseUrl()}${__ENV.ENDPOINT || '/health'}`);
  check(response, { 'gateway health returns 200': (r) => r.status === 200 });
  sleep(0.1);
}
export function handleSummary(data) { return report(data); }
