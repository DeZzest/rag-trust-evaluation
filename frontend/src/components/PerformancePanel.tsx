import { PerformanceMetrics } from "../types/rag.types";

interface PerformancePanelProps {
  metrics: PerformanceMetrics;
}

function metricShare(value: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((Math.max(0, value) / total) * 100).toFixed(1)}%`;
}

export function PerformancePanel({ metrics }: PerformancePanelProps) {
  const total = metrics.totalMs > 0 ? metrics.totalMs : 1;
  const items = [
    {
      label: "Embedding",
      value: metrics.embeddingMs,
      className: "perf-embedding",
    },
    {
      label: "Retrieval",
      value: metrics.retrievalMs,
      className: "perf-retrieval",
    },
    {
      label: "Generation",
      value: metrics.generationMs,
      className: "perf-generation",
    },
    {
      label: "Total",
      value: metrics.totalMs,
      className: "perf-total",
    },
  ];

  return (
    <section className="panel">
      <h2 className="panel-title">Performance Metrics</h2>
      <p className="panel-subtitle">Latency split for explainable and benchmark-friendly demos.</p>

      <div className="performance-grid">
        {items.map((item) => (
          <article key={item.label} className="metric-card">
            <span className="metric-label">{item.label}</span>
            <span className="metric-value">{Math.round(item.value)} ms</span>
            <div className="mini-track">
              <div
                className={`mini-fill ${item.className}`}
                style={{ width: item.label === "Total" ? "100%" : metricShare(item.value, total) }}
              />
            </div>
            <span className="metric-meta">
              {item.label === "Total" ? "End-to-end query time" : metricShare(item.value, total)}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
