import { useState } from "react";
import { RagContextTraceItem } from "../types/rag.types";

interface AnswerCardProps {
  query: string;
  answer: string;
  citations: number[];
  contextTrace: RagContextTraceItem[];
  showRawContext: boolean;
  onToggleRawContext: (next: boolean) => void;
}

type CopyState = "idle" | "copied" | "failed";

function toPercent(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

export function AnswerCard({
  query,
  answer,
  citations,
  contextTrace,
  showRawContext,
  onToggleRawContext,
}: AnswerCardProps) {
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    } finally {
      window.setTimeout(() => setCopyState("idle"), 1800);
    }
  };

  return (
    <section className="panel">
      <div className="panel-row">
        <div>
          <h2 className="panel-title">Answer</h2>
          <p className="panel-subtitle">Generated response grounded in retrieved corpus chunks.</p>
        </div>

        <div className="inline-actions">
          <button type="button" className="secondary-btn" onClick={handleCopy}>
            {copyState === "idle" && "Copy answer"}
            {copyState === "copied" && "Copied"}
            {copyState === "failed" && "Clipboard blocked"}
          </button>

          <button
            type="button"
            className="secondary-btn"
            onClick={() => onToggleRawContext(!showRawContext)}
          >
            {showRawContext ? "Hide raw context" : "Show raw context"}
          </button>
        </div>
      </div>

      <p className="answer-text">{answer || "No answer generated."}</p>

      <p className="muted-text">
        <strong>Query:</strong> {query || "n/a"}
      </p>

      <div className="citation-row">
        {citations.length > 0 ? (
          citations.map((citation) => (
            <span className="badge badge-cite" key={citation}>
              [{citation}]
            </span>
          ))
        ) : (
          <span className="badge badge-muted">No citations detected</span>
        )}
      </div>

      {showRawContext && (
        <div className="context-trace">
          <h3 className="subheading">Context Trace</h3>
          {contextTrace.length === 0 ? (
            <p className="muted-text">Backend did not return context trace data.</p>
          ) : (
            <ul className="trace-list">
              {contextTrace.map((item) => (
                <li key={`${item.sourceId}-${item.citationNumber}`} className="trace-item">
                  <div className="trace-main">
                    <strong>[{item.citationNumber}]</strong> {item.documentId}
                    {item.section ? ` / ${item.section}` : ""}
                    {item.subsection ? ` / ${item.subsection}` : ""}
                  </div>
                  <div className="trace-meta">
                    Confidence {toPercent(item.confidence)} | {item.label || "No label"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
