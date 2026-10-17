import {
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

class JsonSpanExporter implements SpanExporter {
  constructor(private write: (line: string) => void) {}
  export(spans: ReadableSpan[], callback: (result: { code: number }) => void): void {
    try {
      for (const span of spans)
        this.write(
          JSON.stringify({
            level: "info",
            event: "trace.span",
            name: span.name,
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            durationMs: span.duration[0] * 1000 + span.duration[1] / 1e6,
            status: span.status.code,
            taskId: span.attributes["task.id"],
            actionId: span.attributes["action.id"],
            providerId: span.attributes["provider.id"],
          }),
        );
      callback({ code: 0 });
    } catch {
      callback({ code: 1 });
    }
  }
  async shutdown(): Promise<void> {}
}
export function initTracing(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): () => Promise<void> {
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(new JsonSpanExporter(write))],
  });
  provider.register();
  return () => provider.shutdown();
}
