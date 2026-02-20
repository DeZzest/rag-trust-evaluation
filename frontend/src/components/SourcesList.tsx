import { SourceItem } from "../types";

interface Props {
  sources: SourceItem[];
}

function formatSection(source: SourceItem): string {
  if (source.subsection) return source.subsection;
  if (source.section) return source.section;
  return "n/a";
}

function shorten(text: string, maxLength = 220): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

export function SourcesList({ sources }: Props) {
  return (
    <section className="panel">
      <h2 className="panel-title">Retrieved Sources</h2>
      {sources.length === 0 ? (
        <p className="muted-text">No sources returned.</p>
      ) : (
        <ul className="sources-list">
          {sources.map((source, index) => (
            <li key={`${source.documentId}-${index}`} className="source-card">
              <div className="source-title">
                {source.documentId}
                {source.documentYear ? ` (${source.documentYear})` : ""}
              </div>
              <div className="source-meta">
                Section {formatSection(source)} | Similarity {(source.similarity * 100).toFixed(1)}%
              </div>
              <p className="source-snippet">{shorten(source.text)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
