import { useState } from "react";
import { RagContextTraceItem } from "../types/rag.types";

interface AnswerCardProps {
  query: string;
  answer: string;
  citations: number[];
  invalidCitations: number[];
  contextTrace: RagContextTraceItem[];
  showRawContext: boolean;
  onToggleRawContext: (next: boolean) => void;
  onSaveConversation: () => void;
  onExportTxt: () => void;
  onExportJson: () => void;
}

type CopyState = "idle" | "copied" | "failed";

function toPercent(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

function parseCitationToken(token: string): number | null {
  const match = token.match(/^\[(\d+)\]$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function renderAnswerWithHighlights(
  answer: string,
  citations: number[],
  invalidCitations: number[]
): JSX.Element[] {
  const parts = answer.split(/(\[\d+\])/g);
  return parts.map((part, index) => {
    const citationNumber = parseCitationToken(part);
    if (citationNumber === null) {
      return <span key={`text-${index}`}>{part}</span>;
    }

    const isInvalid = invalidCitations.includes(citationNumber);
    const isKnown = citations.includes(citationNumber);
    const className = isInvalid
      ? "inline-citation invalid"
      : isKnown
        ? "inline-citation valid"
        : "inline-citation";

    return (
      <mark key={`cite-${index}`} className={className}>
        {part}
      </mark>
    );
  });
}

export function AnswerCard({
  query,
  answer,
  citations,
  invalidCitations,
  contextTrace,
  showRawContext,
  onToggleRawContext,
  onSaveConversation,
  onExportTxt,
  onExportJson,
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
          <button type="button" className="secondary-btn" onClick={onSaveConversation}>
            Save conversation
          </button>
          <button type="button" className="secondary-btn" onClick={onExportTxt}>
            Export TXT
          </button>
          <button type="button" className="secondary-btn" onClick={onExportJson}>
            Export JSON
          </button>
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

      <div className="answer-text">
        {answer
          ? renderAnswerWithHighlights(answer, citations, invalidCitations)
          : "No answer generated."}
      </div>

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
