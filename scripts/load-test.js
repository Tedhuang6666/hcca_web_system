import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://localhost:8000";

export const options = {
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 20),
      duration: __ENV.DURATION || "1m",
    },
  },
};

export default function () {
  const health = http.get(`${baseUrl}/health`);
  check(health, {
    "health is ok": (res) => res.status === 200,
  });

  const ready = http.get(`${baseUrl}/ready`);
  check(ready, {
    "ready is ok": (res) => res.status === 200,
  });

  const publicRegulations = http.get(`${baseUrl}/regulations?limit=20`);
  check(publicRegulations, {
    "public regulations responds": (res) => res.status < 500,
  });

  const publicDocuments = http.get(`${baseUrl}/documents?limit=20`);
  check(publicDocuments, {
    "public documents responds": (res) => res.status < 500,
  });

  sleep(1);
}
