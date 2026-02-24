import { Metrics } from "../types";

interface Props {
  metrics: Metrics;
}

interface MetricTileProps {
  label: string;
  value: string;
}

function MetricTile({ label, value }: MetricTileProps) {
  return (
    <div className="metric-tile">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function percent(value?: number): string {
  if (value === undefined) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

export function MetricsPanel({ metrics }: Props) {
  return (
    <section className="panel">
      <h2 className="panel-title">Evaluation Metrics</h2>
      <div className="metrics-grid">
        <MetricTile label="Query Trust" value={percent(metrics.trustScore)} />
        <MetricTile label="Citation Coverage" value={percent(metrics.citationCoverage)} />
        <MetricTile label="Citation Validity" value={percent(metrics.citationValidity)} />
        <MetricTile label="Eval Trust" value={percent(metrics.evaluationTrustScore)} />
        <MetricTile label="Retrieval Precision" value={percent(metrics.retrievalPrecision)} />
        <MetricTile label="Retrieval Recall" value={percent(metrics.retrievalRecall)} />
        <MetricTile label="Faithfulness" value={percent(metrics.faithfulness)} />
        <MetricTile label="Avg Similarity" value={percent(metrics.averageSimilarity)} />
        <MetricTile label="Answer Similarity" value={percent(metrics.answerSimilarity)} />
        <MetricTile label="Diagnosis" value={metrics.diagnosis ?? "n/a"} />
      </div>
    </section>
  );
}
