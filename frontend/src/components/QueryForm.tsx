import { QueryPayload } from "../types";

export interface QueryFormValues extends QueryPayload {
  collectionId: string;
  query: string;
  topK: number;
  groundTruth: string;
}

interface Props {
  values: QueryFormValues;
  loading: boolean;
  onChange: (next: QueryFormValues) => void;
  onSubmit: () => void;
}

export function QueryForm({ values, loading, onChange, onSubmit }: Props) {
  return (
    <section className="panel">
      <h2 className="panel-title">Ask Your Question</h2>
      <p className="panel-subtitle">
        Submit a policy query and inspect trust, citations, sources, and evaluation metrics.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>Collection ID (optional)</span>
          <input
            type="text"
            value={values.collectionId}
            onChange={(e) =>
              onChange({ ...values, collectionId: e.target.value })
            }
            placeholder="Defaults to CHROMA_COLLECTION"
          />
        </label>

        <label className="field field-sm">
          <span>Top K</span>
          <input
            type="number"
            min={1}
            max={10}
            value={values.topK}
            onChange={(e) =>
              onChange({
                ...values,
                topK: Math.max(1, Number(e.target.value) || 1),
              })
            }
          />
        </label>
      </div>

      <label className="field">
        <span>Question</span>
        <textarea
          value={values.query}
          onChange={(e) => onChange({ ...values, query: e.target.value })}
          placeholder="Ask a university policy question..."
          rows={6}
        />
      </label>

      <label className="field">
        <span>Ground Truth (optional, used for /rag/evaluate)</span>
        <textarea
          value={values.groundTruth}
          onChange={(e) => onChange({ ...values, groundTruth: e.target.value })}
          placeholder="Paste expected answer to compute answer similarity"
          rows={4}
        />
      </label>

      <button
        className="primary-btn"
        type="button"
        disabled={loading || values.query.trim().length === 0}
        onClick={onSubmit}
      >
        {loading ? "Generating..." : "Ask"}
      </button>
    </section>
  );
}
