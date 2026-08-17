"""Optional OpenTelemetry setup for API and Celery processes."""

from __future__ import annotations

import logging

from api.core.config import settings

logger = logging.getLogger(__name__)
_api_initialized = False
_celery_initialized = False


def _otel_headers() -> dict[str, str]:
    """Parse OTLP headers without exposing credentials in application logs."""
    headers: dict[str, str] = {}
    for item in settings.OTEL_EXPORTER_OTLP_HEADERS.split(","):
        key, separator, value = item.partition("=")
        if key.strip() and separator and value.strip():
            headers[key.strip()] = value.strip()
    return headers


def init_api_tracing(app: object, *, engine: object) -> bool:
    """Instrument FastAPI and SQLAlchemy when an OTLP collector is configured."""
    global _api_initialized
    if _api_initialized or not settings.OTEL_ENABLED:
        return _api_initialized

    try:
        from opentelemetry import trace
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.instrumentation.redis import RedisInstrumentor
        from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
        from opentelemetry.sdk.resources import (
            DEPLOYMENT_ENVIRONMENT,
            SERVICE_NAME,
            SERVICE_VERSION,
            Resource,
        )
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.sdk.trace.sampling import TraceIdRatioBased
    except ImportError:
        logger.warning("OpenTelemetry dependencies are not installed; tracing disabled")
        return False

    resource = Resource.create(
        {
            SERVICE_NAME: settings.OTEL_SERVICE_NAME,
            SERVICE_VERSION: settings.APP_RELEASE or settings.APP_VERSION,
            DEPLOYMENT_ENVIRONMENT: settings.ENVIRONMENT,
        }
    )
    provider = TracerProvider(
        resource=resource,
        sampler=TraceIdRatioBased(settings.OTEL_TRACES_SAMPLE_RATE),
    )
    endpoint = settings.OTEL_EXPORTER_OTLP_ENDPOINT.rstrip("/")
    try:
        if "/integration/otlp" in endpoint:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                OTLPSpanExporter,
            )

            exporter = OTLPSpanExporter(
                endpoint=f"{endpoint}/v1/traces",
                headers=_otel_headers(),
            )
        else:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
                OTLPSpanExporter,
            )

            exporter = OTLPSpanExporter(
                endpoint=settings.OTEL_EXPORTER_OTLP_ENDPOINT,
                insecure=settings.OTEL_EXPORTER_OTLP_ENDPOINT.startswith("http://"),
                headers=_otel_headers(),
            )
    except ImportError:
        logger.warning("Configured OpenTelemetry exporter is not installed; tracing disabled")
        return False
    provider.add_span_processor(
        BatchSpanProcessor(
            exporter,
            max_queue_size=2_048,
            schedule_delay_millis=5_000,
            max_export_batch_size=512,
            export_timeout_millis=2_000,
        )
    )
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, excluded_urls="health,live,ready,metrics")
    SQLAlchemyInstrumentor().instrument(engine=engine.sync_engine)
    RedisInstrumentor().instrument()
    _api_initialized = True
    logger.info(
        "OpenTelemetry API tracing enabled service=%s endpoint=%s",
        settings.OTEL_SERVICE_NAME,
        settings.OTEL_EXPORTER_OTLP_ENDPOINT,
    )
    return True


def init_celery_tracing() -> bool:
    """Instrument Celery workers when the optional instrumentation is installed."""
    global _celery_initialized
    if _celery_initialized or not settings.OTEL_ENABLED:
        return _celery_initialized

    try:
        from opentelemetry.instrumentation.celery import CeleryInstrumentor
    except ImportError:
        logger.warning("OpenTelemetry Celery instrumentation is not installed")
        return False

    CeleryInstrumentor().instrument()
    _celery_initialized = True
    logger.info("OpenTelemetry Celery tracing enabled service=%s", settings.OTEL_SERVICE_NAME)
    return True


__all__ = ["init_api_tracing", "init_celery_tracing"]
