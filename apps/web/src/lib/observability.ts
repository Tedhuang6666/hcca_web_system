// Next.js server-side OpenTelemetry bootstrap.

let started = false;

function getTraceSampleRate(): number {
  const value = Number(
    process.env.OTEL_WEB_TRACES_SAMPLE_RATE ?? process.env.OTEL_TRACES_SAMPLE_RATE ?? "0.1",
  );
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.1;
}

export async function initOpenTelemetry(): Promise<boolean> {
  if (started || process.env.OTEL_ENABLED !== "true") {
    return started;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return false;
  }

  try {
    const [
      { NodeSDK },
      { OTLPTraceExporter },
      { HttpInstrumentation },
      { resourceFromAttributes },
      { TraceIdRatioBasedSampler },
      semconv,
    ] = await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@opentelemetry/exporter-trace-otlp-proto"),
        import("@opentelemetry/instrumentation-http"),
        import("@opentelemetry/resources"),
        import("@opentelemetry/sdk-trace-base"),
        import("@opentelemetry/semantic-conventions"),
      ]);

    const exporter = new OTLPTraceExporter({
      url: endpoint.endsWith("/v1/traces") ? endpoint : endpoint + "/v1/traces",
    });
    const resource = resourceFromAttributes({
      [semconv.ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "hcca-web",
      [semconv.ATTR_SERVICE_VERSION]: process.env.APP_RELEASE || "unknown",
      [semconv.ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
        process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NODE_ENV || "development",
    });
    const sdk = new NodeSDK({
      resource,
      traceExporter: exporter,
      sampler: new TraceIdRatioBasedSampler(getTraceSampleRate()),
      instrumentations: [new HttpInstrumentation()],
    });

    await sdk.start();
    started = true;
    return true;
  } catch (error) {
    console.warn("[observability] failed to initialize OpenTelemetry", error);
    return false;
  }
}
