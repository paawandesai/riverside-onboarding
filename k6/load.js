// Load test for the stated benchmark load: 20 concurrent virtual users for 60 s.
//   k6 run -e BASE_URL=http://localhost:8000 -e INVITE_CODE=... k6/load.js
// Scenarios run one after another:
//   api_load  20 VUs x 60 s: chat turn + list slots + read intake   (target p95 < 3 s)
//   ocr       20 sequential ID uploads from the synthetic golden set (target p95 < 8 s)
//   booking   20 sequential bookings                                (target p95 < 1 s)
// The chat path measured is whatever the server is configured for: check /api/health
// ("llm.mode") and report it alongside the numbers. Nothing is stubbed.
import http from "k6/http";
import { check, fail } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8000";
const INVITE = __ENV.INVITE_CODE;
if (!INVITE) throw new Error("set INVITE_CODE (one of the INVITE_CODES configured on the target)");
// Throwaway accounts get a random per-run password; nothing reusable is committed.
const RUN_PASSWORD = `k6-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const ocrImage = open("../fixtures/generated-ids/specimen-11.jpg", "b");

const chatTrend = new Trend("chat_ms", true);
const ocrTrend = new Trend("ocr_ms", true);
const bookingTrend = new Trend("booking_ms", true);

export const options = {
  scenarios: {
    api_load: { executor: "constant-vus", vus: 20, duration: "60s", exec: "apiLoad" },
    ocr: { executor: "per-vu-iterations", vus: 1, iterations: 20, exec: "ocr", startTime: "62s", maxDuration: "5m" },
    booking: { executor: "per-vu-iterations", vus: 1, iterations: 20, exec: "booking", startTime: "62s", maxDuration: "2m" },
  },
  thresholds: {
    "http_req_duration{scenario:api_load}": ["p(95)<3000"],
    chat_ms: ["p(95)<3000"],
    ocr_ms: ["p(95)<8000"],
    booking_ms: ["p(95)<1000"],
    "http_req_failed{scenario:api_load}": ["rate<0.01"],
  },
};

// The API's CSRF guard requires this header on every mutating call, as the SPA sends it.
const CSRF = { "X-Requested-With": "onboarding-app" };

function signup(i) {
  const email = `k6-${Date.now()}-${i}@example.com`;
  const res = http.post(
    `${BASE}/api/auth/signup`,
    JSON.stringify({ email, password: RUN_PASSWORD, invite_code: INVITE, adult_attestation: true }),
    { headers: { ...CSRF, "Content-Type": "application/json" } },
  );
  // Fail the run outright: thresholds over zero samples would otherwise "pass".
  if (!check(res, { "signup 201": (r) => r.status === 201 })) fail(`signup returned ${res.status}`);
  const cookie = `onboarding_session=${res.cookies.onboarding_session[0].value}`;
  // Photo consent is separate and optional; load-test users agree so the OCR scenario can run.
  http.post(`${BASE}/api/consent`, JSON.stringify({ photo_scan: true }), {
    headers: { ...CSRF, Cookie: cookie, "Content-Type": "application/json" },
  });
  return cookie;
}

export function setup() {
  const health = http.get(`${BASE}/api/health`).json();
  console.log(`chat path under test: ${health.llm.mode} (model: ${health.llm.model})`);
  const cookies = [];
  for (let i = 0; i < 22; i++) cookies.push(signup(i));
  return { cookies };
}

export function apiLoad(data) {
  const headers = { ...CSRF, Cookie: data.cookies[(__VU - 1) % 20], "Content-Type": "application/json" };
  const chat = http.post(
    `${BASE}/api/chat`,
    JSON.stringify({ messages: [{ role: "user", content: "I'd like a check-up for a cough I've had for two weeks" }] }),
    { headers },
  );
  chatTrend.add(chat.timings.duration);
  check(chat, { "chat 200": (r) => r.status === 200 });
  check(http.get(`${BASE}/api/slots`, { headers }), { "slots 200": (r) => r.status === 200 });
  http.get(`${BASE}/api/intake`, { headers, responseCallback: http.expectedStatuses(200, 404) });
}

export function ocr(data) {
  const res = http.post(
    `${BASE}/api/documents/extract`,
    { file: http.file(ocrImage, "card.jpg", "image/jpeg") },
    { headers: { ...CSRF, Cookie: data.cookies[20] } },
  );
  ocrTrend.add(res.timings.duration);
  check(res, { "ocr 200": (r) => r.status === 200 });
}

export function booking(data) {
  const headers = { ...CSRF, Cookie: data.cookies[21], "Content-Type": "application/json" };
  const slots = http.get(`${BASE}/api/slots`, { headers }).json();
  const slot = slots[__ITER % slots.length];
  const res = http.post(`${BASE}/api/bookings`, JSON.stringify({ slot_id: slot.id }), { headers });
  bookingTrend.add(res.timings.duration);
  check(res, { "booking 201": (r) => r.status === 201 });
}
