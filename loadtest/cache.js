// Setup: local Compose, authenticated non-mutating endpoint with a stable request
// body. Run once with CACHE_MODE=off and once on; compare only same-machine runs.
// Configure ENDPOINT, METHOD, BODY, AUTH_TOKEN and expected status for the chosen route.
import http from 'k6/http';
import { checks, authHeaders, baseUrl, report } from './common.js';

export const options = { vus: Number(__ENV.VUS || 5), duration: __ENV.DURATION || '30s' };
export default function () {
  const url = `${baseUrl()}${__ENV.ENDPOINT || '/health'}`;
  const response = (__ENV.METHOD || 'GET').toUpperCase() === 'POST'
    ? http.post(url, __ENV.BODY || '{}', { headers: authHeaders() })
    : http.get(url, { headers: authHeaders() });
  checks(response, Number(__ENV.EXPECT_STATUS || 200));
}
export function handleSummary(data) { return report(data); }
