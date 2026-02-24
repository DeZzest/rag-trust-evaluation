import { RagSource } from "../types/rag.types";

interface SourcesPanelProps {
  sources: RagSource[];
  showDebugScores: boolean;
  onToggleDebugScores: (next: boolean) => void;
}

function toPercent(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function shortText(text: string, max = 340): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trim()}...`;
}

export function SourcesPanel({
  sources,
  showDebugScores,
  onToggleDebugScores,
}: SourcesPanelProps) {
  return (
    <section className="panel">
      <div className="panel-row">
        <div>
          <h2 className="panel-title">Retrieved Sources</h2>
          <p className="panel-subtitle">Expandable evidence cards with transparent ranking signals.</p>
        </div>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => onToggleDebugScores(!showDebugScores)}
        >
          {showDebugScores ? "Hide rerank debug" : "Show rerank debug"}
        </button>
      </div>

      {sources.length === 0 ? (
        <p className="muted-text">No sources were returned for this query.</p>
      ) : (
        <div className="sources-stack">
          {sources.map((source, index) => (
            <details key={`${source.documentId}-${index}`} className="source-card" open={index === 0}>
              <summary className="source-summary">
                <div className="source-rank">#{index + 1}</div>
                <div className="source-main">
                  <div className="source-title">
                    {source.documentId}
                    {source.documentYear ? ` (${source.documentYear})` : ""}
                  </div>
                  <div className="source-meta">
                    Similarity {toPercent(source.similarity)} | Confidence {toPercent(source.confidence)}
                  </div>
                </div>
              </summary>

              <div className="source-content">
                <div className="chip-line">
                  <span className="badge badge-muted">Section: {source.section ?? "n/a"}</span>
                  <span className="badge badge-muted">Subsection: {source.subsection ?? "n/a"}</span>
                </div>

                <p className="source-snippet">{shortText(source.text)}</p>

                {showDebugScores && (
                  <div className="debug-box">
                    <div>Distance: {source.distance.toFixed(4)}</div>
                    <div>Similarity: {source.similarity.toFixed(4)}</div>
                    <div>Confidence: {source.confidence.toFixed(4)}</div>
                    {source.metadata && (
                      <pre className="metadata-pre">{JSON.stringify(source.metadata, null, 2)}</pre>
                    )}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
