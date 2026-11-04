import { config } from "dotenv";
import { resolve } from "node:path";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
config({ path: resolve(process.cwd(), "../../.env") });
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: "fieldwork-api",
    traceExporter: new OTLPTraceExporter({
      url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, "")}/v1/traces`,
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) =>
          req.url?.includes("/health") || req.url?.includes("/ready") || false,
      }),
    ],
  });
  sdk.start();
  process.on("SIGTERM", () => {
    void sdk.shutdown();
  });
}
