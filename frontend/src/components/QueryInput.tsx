import { QueryInputValues } from "../types/rag.types";

interface QueryInputProps {
  values: QueryInputValues;
  collections: string[];
  quickQueries: string[];
  loading: boolean;
  onChange: (next: QueryInputValues) => void;
  onSubmit: () => void;
}

export function QueryInput({
  values,
  collections,
  quickQueries,
  loading,
  onChange,
  onSubmit,
}: QueryInputProps) {
  const hasPreset = collections.includes(values.collectionId);
  const collectionSelector = hasPreset ? values.collectionId : "__custom";
  const isCustomCollection = collectionSelector === "__custom";

  return (
    <section className="panel query-panel">
      <div className="panel-header">
        <h2 className="panel-title">Query Console</h2>
        <p className="panel-subtitle">
          Enter a question, choose collection, and inspect explainability metrics.
        </p>
      </div>

      <div className="query-grid">
        <label className="field">
          <span>Collection Profile</span>
          <select
            value={collectionSelector}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "__custom") {
                onChange({
                  ...values,
                  collectionId: hasPreset ? "" : values.collectionId,
                });
                return;
              }

              onChange({
                ...values,
                collectionId: next,
              });
            }}
          >
            {collections.map((collection) => (
              <option key={collection} value={collection}>
                {collection}
              </option>
            ))}
            <option value="__custom">Custom collection ID</option>
          </select>
        </label>

        <label className="field field-compact">
          <span>Top K</span>
          <input
            type="number"
            min={1}
            max={12}
            value={values.topK}
            onChange={(event) => {
              onChange({
                ...values,
                topK: Math.max(1, Math.min(12, Number(event.target.value) || 1)),
              });
            }}
          />
        </label>

        <label className="field field-check">
          <input
            type="checkbox"
            checked={values.includeFaithfulness}
            onChange={(event) =>
              onChange({
                ...values,
                includeFaithfulness: event.target.checked,
              })
            }
          />
          <span>Include faithfulness check</span>
        </label>
      </div>

      {isCustomCollection && (
        <label className="field">
          <span>Custom collection ID</span>
          <input
            type="text"
            value={values.collectionId}
            onChange={(event) =>
              onChange({
                ...values,
                collectionId: event.target.value,
              })
            }
            placeholder="Paste collection UUID or name"
          />
        </label>
      )}

      <label className="field">
        <span>Question</span>
        <textarea
          rows={6}
          value={values.query}
          onChange={(event) =>
            onChange({
              ...values,
              query: event.target.value,
            })
          }
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
          placeholder="Example: What documents are required for admission?"
        />
      </label>

      <div className="quick-queries">
        {quickQueries.map((query) => (
          <button
            key={query}
            type="button"
            className="ghost-chip"
            onClick={() =>
              onChange({
                ...values,
                query,
              })
            }
          >
            {query}
          </button>
        ))}
      </div>

      <div className="actions-row">
        <button
          type="button"
          className="primary-btn"
          disabled={
            loading ||
            values.query.trim().length === 0 ||
            values.collectionId.trim().length === 0
          }
          onClick={onSubmit}
        >
          {loading ? "Processing..." : "Run RAG Query"}
        </button>
        <span className="hint-text">Tip: press Ctrl/Cmd + Enter to submit quickly.</span>
      </div>
    </section>
  );
}
