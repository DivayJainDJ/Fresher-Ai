// Setup: local Compose and a test account/token; use an authenticated AI route
// only with a harmless request. This compares limiter behavior, not provider load.
import http from 'k6/http';
import { check } from 'k6';
import { authHeaders, baseUrl, report } from './common.js';

export const options = { vus: Number(__ENV.VUS || 20), duration: __ENV.DURATION || '30s' };
export default function () {
  const response = http.get(`${baseUrl()}${__ENV.ENDPOINT || '/api/me'}`, { headers: authHeaders() });
  check(response, { 'response is success or rate limited': (r) => r.status < 400 || r.status === 429 });
}
export function handleSummary(data) { return report(data); }
