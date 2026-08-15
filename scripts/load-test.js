import http from "k6/http";
import ws from "k6/ws";
import { check, group, sleep } from "k6";
import { Rate } from "k6/metrics";

const baseUrl = (__ENV.BASE_URL || "http://localhost:8000").replace(/\/$/, "");
// 瀏覽器驗證改為 HttpOnly cookie；請提供 access cookie 的「值」，不要提供 Bearer token。
const authCookie = __ENV.AUTH_COOKIE;
const authCookieName = __ENV.AUTH_COOKIE_NAME || "__Host-hcca_access_token";
const enableWrites = __ENV.ENABLE_WRITES === "true";
const duration = __ENV.DURATION || "1m";
const readVus = Number(__ENV.VUS || 10);
export const serverErrors = new Rate("server_errors");

const scenarios = {
  public_reads: {
    executor: "constant-vus",
    exec: "publicReads",
    vus: readVus,
    duration,
  },
};

if (authCookie) {
  scenarios.authenticated_reads = {
    executor: "constant-vus",
    exec: "authenticatedReads",
    vus: Number(__ENV.AUTH_VUS || 5),
    duration,
    startTime: "2s",
  };
}

if (authCookie && enableWrites) {
  scenarios.isolated_writes = {
    executor: "constant-arrival-rate",
    exec: "isolatedWrites",
    rate: Number(__ENV.WRITE_RATE || 1),
    timeUnit: "10s",
    duration,
    preAllocatedVUs: 1,
    maxVUs: Number(__ENV.WRITE_MAX_VUS || 3),
    startTime: "5s",
  };
}

const thresholds = {
  server_errors: ["rate<0.005"],
  http_req_duration: ["p(99)<1500"],
  "http_req_duration{flow:public_read}": ["p(95)<300"],
};

if (authCookie) {
  thresholds["http_req_duration{flow:authenticated_read}"] = ["p(95)<300"];
  if (__ENV.DOCUMENT_ID) {
    thresholds["http_req_duration{flow:document_detail}"] = ["p(95)<300"];
  }
}

if (authCookie && enableWrites) {
  thresholds["http_req_duration{flow:write}"] = ["p(95)<600"];
}

if (__ENV.WS_URL) {
  scenarios.websocket_connections = {
    executor: "constant-vus",
    exec: "websocketConnections",
    vus: Number(__ENV.WS_VUS || 300),
    duration: __ENV.WS_DURATION || duration,
  };
}

export const options = { scenarios, thresholds };

function authParams(flow, name) {
  return {
    headers: {
      Cookie: `${authCookieName}=${authCookie}`,
      "Content-Type": "application/json",
    },
    tags: { flow, name },
  };
}

function expectSuccess(response, label) {
  serverErrors.add(response.status >= 500);
  check(response, {
    [`${label} responds without server error`]: (res) => res.status < 500,
  });
}

export function publicReads() {
  group("public health and lists", () => {
    expectSuccess(
      http.get(`${baseUrl}/health`, { tags: { flow: "public_read", name: "health" } }),
      "health",
    );
    expectSuccess(
      http.get(`${baseUrl}/ready`, { tags: { flow: "public_read", name: "ready" } }),
      "ready",
    );
    expectSuccess(
      http.get(`${baseUrl}/regulations?limit=20`, {
        tags: { flow: "public_read", name: "regulations" },
      }),
      "regulations",
    );
    expectSuccess(
      http.get(`${baseUrl}/documents?limit=20`, {
        tags: { flow: "public_read", name: "documents" },
      }),
      "documents",
    );
  });
  sleep(1);
}

export function authenticatedReads() {
  group("authenticated core reads", () => {
    expectSuccess(
      http.get(`${baseUrl}/documents?limit=20`, authParams("authenticated_read", "documents")),
      "authenticated documents",
    );
    expectSuccess(
      http.get(`${baseUrl}/meetings?limit=20`, authParams("authenticated_read", "meetings")),
      "meetings",
    );
    expectSuccess(
      http.get(`${baseUrl}/shop/orders?limit=20`, authParams("authenticated_read", "orders")),
      "orders",
    );
    expectSuccess(
      http.get(`${baseUrl}/surveys?limit=20`, authParams("authenticated_read", "surveys")),
      "surveys",
    );
    if (__ENV.DOCUMENT_ID) {
      expectSuccess(
        http.get(
          `${baseUrl}/documents/${__ENV.DOCUMENT_ID}`,
          authParams("document_detail", "document_detail"),
        ),
        "document detail",
      );
    }
  });
  sleep(1);
}

function postConfigured(urlEnv, bodyEnv, name) {
  const path = __ENV[urlEnv];
  const body = __ENV[bodyEnv];
  if (!path || !body) return;
  const response = http.post(
    `${baseUrl}${path}`,
    body,
    authParams("write", name),
  );
  expectSuccess(response, name);
}

export function isolatedWrites() {
  // Paths and JSON bodies point at disposable records in an isolated test database.
  postConfigured("APPROVAL_PATH", "APPROVAL_BODY", "document_approval");
  postConfigured("MEETING_PATH", "MEETING_BODY", "meeting_decision");
  postConfigured("ORDER_PATH", "ORDER_BODY", "order_write");
  postConfigured("SURVEY_PATH", "SURVEY_BODY", "survey_submission");
  sleep(1);
}

export function websocketConnections() {
  const url = __ENV.WS_URL;
  ws.connect(url, { headers: { Cookie: `${authCookieName}=${authCookie}` } }, (socket) => {
    socket.on("message", (message) => {
      try {
        if (JSON.parse(message).type === "ping") socket.send(JSON.stringify({ type: "pong" }));
      } catch {
        // 忽略非 JSON 推播，仍以 REST 作為資料真相。
      }
    });
    socket.setTimeout(() => socket.close(), Number(__ENV.WS_HOLD_MS || 30_000));
  });
}
