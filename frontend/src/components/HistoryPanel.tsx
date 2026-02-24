import { SavedConversation } from "../types/rag.types";

interface HistoryPanelProps {
  entries: SavedConversation[];
  activeId: string | null;
  onLoad: (entry: SavedConversation) => void;
  onRun: (entry: SavedConversation) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

function shortQuery(value: string, maxLength = 88): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function HistoryPanel({
  entries,
  activeId,
  onLoad,
  onRun,
  onDelete,
  onClear,
}: HistoryPanelProps) {
  return (
    <section className="panel">
      <div className="panel-row">
        <div>
          <h2 className="panel-title">Request History</h2>
          <p className="panel-subtitle">Saved local snapshots for repeatable demos.</p>
        </div>
        <button
          type="button"
          className="secondary-btn"
          onClick={onClear}
          disabled={entries.length === 0}
        >
          Clear history
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="muted-text">History is empty. Run a query to create snapshots.</p>
      ) : (
        <ul className="history-list">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={activeId === entry.id ? "history-item active" : "history-item"}
            >
              <div className="history-top">
                <strong>{shortQuery(entry.payload.query)}</strong>
                <span className="history-date">{formatDate(entry.createdAt)}</span>
              </div>
              <div className="history-meta">
                Collection: {entry.payload.collectionId} | TopK: {entry.payload.topK ?? 3}
              </div>

              <div className="history-actions">
                <button type="button" className="secondary-btn" onClick={() => onLoad(entry)}>
                  Load
                </button>
                <button type="button" className="secondary-btn" onClick={() => onRun(entry)}>
                  Run again
                </button>
                <button type="button" className="secondary-btn" onClick={() => onDelete(entry.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
