interface Props {
  value: number;
}

function clampPercent(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * 100;
}

export function TrustBar({ value }: Props) {
  const percent = clampPercent(value);
  const qualityClass =
    percent >= 70 ? "trust-good" : percent >= 45 ? "trust-mid" : "trust-low";

  return (
    <section className="panel">
      <h2 className="panel-title">Trust Score</h2>
      <div className="trust-label">{percent.toFixed(1)}%</div>
      <div className="trust-track" role="progressbar" aria-valuenow={percent}>
        <div className={`trust-fill ${qualityClass}`} style={{ width: `${percent}%` }} />
      </div>
    </section>
  );
}
