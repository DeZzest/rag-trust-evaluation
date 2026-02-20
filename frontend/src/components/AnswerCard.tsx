interface Props {
  answer: string;
  citations: number[];
}

export function AnswerCard({ answer, citations }: Props) {
  return (
    <section className="panel">
      <h2 className="panel-title">Answer</h2>
      <p className="answer-text">{answer}</p>

      <div className="chip-row">
        {citations.length > 0 ? (
          citations.map((citation) => (
            <span key={citation} className="chip">
              [{citation}]
            </span>
          ))
        ) : (
          <span className="chip chip-muted">No citations detected</span>
        )}
      </div>
    </section>
  );
}
