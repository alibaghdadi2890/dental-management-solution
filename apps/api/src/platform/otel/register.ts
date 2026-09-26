import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * Must load before anything else so HTTP, Express, pg, ioredis and Nest get instrumented.
 * Configured entirely through the standard OTEL_* environment variables (exporter, endpoint,
 * sampling); `OTEL_SDK_DISABLED=true` turns it off (CLAUDE.md §15).
 */
if (process.env['OTEL_SDK_DISABLED'] !== 'true') {
  const sdk = new NodeSDK({
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'dcm-api',
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => {
    void sdk.shutdown();
  });
}
