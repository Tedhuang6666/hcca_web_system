// Next.js server-side OpenTelemetry bootstrap.

let started = false;

export async function initOpenTelemetry(): Promise<boolean> {
  if (started || process.env.OTEL_ENABLED !== "true") {
    return started;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) {
    return false;
  }

  try {
    const [{ NodeSDK }, { OTLPTraceExporter }, { HttpInstrumentation }, { resourceFromAttributes }, semconv] =
      await Promise.all([
        import("@opentelemetry/sdk-node"),
        import("@opentelemetry/exporter-trace-otlp-proto"),
        import("@opentelemetry/instrumentation-http"),
        import("@opentelemetry/resources"),
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
