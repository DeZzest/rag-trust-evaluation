import { toPercent } from "../api/rag";
import { CitationValidation, TrustResult, TrustViewMode } from "../types/rag.types";

interface TrustPanelProps {
  trust: TrustResult;
  citationValidation: CitationValidation;
  backendScore: number;
  displayedScore: number;
  viewMode: TrustViewMode;
  onViewModeChange: (next: TrustViewMode) => void;
}

function scoreTone(score: number): "good" | "mid" | "low" {
  if (score >= 0.8) return "good";
  if (score >= 0.6) return "mid";
  return "low";
}

export function TrustPanel({
  trust,
  citationValidation,
  backendScore,
  displayedScore,
  viewMode,
  onViewModeChange,
}: TrustPanelProps) {
  const tone = scoreTone(displayedScore);

  return (
    <section className="panel">
      <div className="panel-row">
        <div>
          <h2 className="panel-title">Trust Score</h2>
          <p className="panel-subtitle">Citation quality and trust controls for transparent RAG.</p>
        </div>
        <div className="segmented-control" role="group" aria-label="Trust score mode">
          <button
            type="button"
            className={viewMode === "backend" ? "segment active" : "segment"}
            onClick={() => onViewModeChange("backend")}
          >
            Lightweight
          </button>
          <button
            type="button"
            className={viewMode === "strict" ? "segment active" : "segment"}
            onClick={() => onViewModeChange("strict")}
          >
            Strict
          </button>
        </div>
      </div>

      <div className="trust-headline">
        <span className={`trust-number trust-${tone}`}>{toPercent(displayedScore)}</span>
        <span className="badge badge-muted">Mode: {trust.mode}</span>
      </div>

      <div className="progress-track" role="progressbar" aria-valuenow={displayedScore * 100}>
        <div className={`progress-fill fill-${tone}`} style={{ width: `${displayedScore * 100}%` }} />
      </div>

      <div className="trust-grid">
        <div className="metric-card">
          <span className="metric-label">Backend score</span>
          <span className="metric-value">{toPercent(backendScore)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Citation coverage</span>
          <span className="metric-value">{toPercent(citationValidation.coverage)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Citation validity</span>
          <span className="metric-value">{toPercent(citationValidation.citationValidity)}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Validation</span>
          <span className="metric-value">{citationValidation.isValid ? "Valid" : "Warnings"}</span>
        </div>
      </div>

      {citationValidation.issues.length > 0 && (
        <p className="muted-text">
          Issues: {citationValidation.issues.join(", ")}
        </p>
      )}
    </section>
  );
}
