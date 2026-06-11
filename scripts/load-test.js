import http from "k6/http";
import { check, group, sleep } from "k6";

const baseUrl = (__ENV.BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const token = __ENV.AUTH_TOKEN;
const enableWrites = __ENV.ENABLE_WRITES === "true";
const duration = __ENV.DURATION || "1m";
const readVus = Number(__ENV.VUS || 10);

const scenarios = {
  public_reads: {
    executor: "constant-vus",
    exec: "publicReads",
    vus: readVus,
    duration,
  },
};

if (token) {
  scenarios.authenticated_reads = {
    executor: "constant-vus",
    exec: "authenticatedReads",
    vus: Number(__ENV.AUTH_VUS || 5),
    duration,
    startTime: "2s",
  };
}

if (token && enableWrites) {
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
  http_req_failed: ["rate<0.01"],
  "http_req_duration{flow:public_read}": ["p(95)<500"],
};

if (token) {
  thresholds["http_req_duration{flow:authenticated_read}"] = ["p(95)<500"];
  if (__ENV.DOCUMENT_ID) {
    thresholds["http_req_duration{flow:document_detail}"] = ["p(95)<800"];
  }
}

if (token && enableWrites) {
  thresholds["http_req_duration{flow:write}"] = ["p(95)<1500"];
}

export const options = { scenarios, thresholds };

function authParams(flow, name) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    tags: { flow, name },
  };
}

function expectSuccess(response, label) {
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
