import { useMemo, useState } from "react";
import {
  getCollectionSuggestions,
  getDefaultCollectionId,
  getStrictTrustScore,
  queryRag,
  toPercent,
} from "../api/rag";
import { AnswerCard } from "../components/AnswerCard";
import { PerformancePanel } from "../components/PerformancePanel";
import { QueryInput } from "../components/QueryInput";
import { SourcesPanel } from "../components/SourcesPanel";
import { TrustPanel } from "../components/TrustPanel";
import { QueryInputValues, RagQueryResponse, TrustViewMode } from "../types/rag.types";

const QUICK_QUERIES = [
  "Які документи потрібні для вступу на магістратуру?",
  "Що передбачено положенням про академічну доброчесність?",
  "Які правила призначення стипендії в університеті?",
  "Де знайти інформацію про матеріально-технічну базу ЛУТЕ?",
];

function ResultSkeleton() {
  return (
    <>
      <section className="panel skeleton-panel">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </section>
      <div className="split-layout">
        <section className="panel skeleton-panel">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </section>
        <section className="panel skeleton-panel">
          <div className="skeleton-line skeleton-title" />
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </section>
      </div>
    </>
  );
}

const defaultCollectionId = getDefaultCollectionId();
const knownCollections = getCollectionSuggestions();

const initialForm: QueryInputValues = {
  query: "",
  collectionId: defaultCollectionId,
  topK: 3,
  includeFaithfulness: false,
};

export function RagPage() {
  const [form, setForm] = useState<QueryInputValues>(initialForm);
  const [result, setResult] = useState<RagQueryResponse | null>(null);
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRawContext, setShowRawContext] = useState(false);
  const [showDebugScores, setShowDebugScores] = useState(false);
  const [trustViewMode, setTrustViewMode] = useState<TrustViewMode>("backend");

  const backendScore = result?.trust.score ?? 0;
  const displayedScore =
    result && trustViewMode === "strict"
      ? getStrictTrustScore(
          result.trust.score,
          result.citationValidation.coverage,
          result.citationValidation.citationValidity
        )
      : backendScore;

  const statusText = useMemo(() => {
    if (loading) return "Running retrieval, generation, and trust validation...";
    if (error) return error;
    if (!result) {
      return "Submit a query to inspect answer quality, sources, trust, and latency.";
    }
    if (result.citationValidation.isValid) {
      return "Response generated with valid citation coverage.";
    }
    return "Response generated with citation warnings. Check the trust panel for details.";
  }, [loading, error, result]);

  const utf8Hint = useMemo(() => {
    if (!error) return null;
    return error.toLowerCase().includes("utf-8")
      ? "Hint: verify UTF-8 request payload if you query the backend manually."
      : null;
  }, [error]);

  const handleSubmit = async () => {
    if (!form.query.trim()) {
      setError("Field 'query' cannot be empty.");
      return;
    }
    if (!form.collectionId.trim()) {
      setError("Field 'collectionId' is required.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setLastSubmittedQuery(form.query.trim());
    setShowRawContext(false);
    setShowDebugScores(false);

    try {
      const response = await queryRag({
        query: form.query,
        collectionId: form.collectionId,
        topK: form.topK,
        includeFaithfulness: form.includeFaithfulness,
      });
      setResult(response);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Request failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="rag-shell">
      <header className="panel hero">
        <div className="hero-main">
          <p className="eyebrow">RAG Trust Evaluation</p>
          <h1 className="hero-title">LUTE RAG Dashboard</h1>
          <p className="status-text">{statusText}</p>
        </div>
        <div className="hero-side">
          <span className="badge badge-hero">Collection: {form.collectionId || "n/a"}</span>
          <span className="badge badge-hero">TopK: {form.topK}</span>
          {result && <span className="badge badge-hero">Sources: {result.retrieved.length}</span>}
          {result && <span className="badge badge-hero">Trust: {toPercent(displayedScore)}</span>}
        </div>
      </header>

      <QueryInput
        values={form}
        collections={knownCollections}
        quickQueries={QUICK_QUERIES}
        loading={loading}
        onChange={setForm}
        onSubmit={handleSubmit}
      />

      {error && (
        <section className="panel alert-panel" role="alert">
          <h2 className="panel-title">Request Error</h2>
          <p className="error-text">{error}</p>
          {utf8Hint && <p className="muted-text">{utf8Hint}</p>}
        </section>
      )}

      {loading && <ResultSkeleton />}

      {!loading && !result && !error && (
        <section className="panel empty-panel">
          <h2 className="panel-title">Awaiting Query</h2>
          <p className="panel-subtitle">
            Start with one of the quick prompts above or enter your own question.
          </p>
        </section>
      )}

      {!loading && result && (
        <>
          <div className="split-layout">
            <TrustPanel
              trust={result.trust}
              citationValidation={result.citationValidation}
              backendScore={backendScore}
              displayedScore={displayedScore}
              viewMode={trustViewMode}
              onViewModeChange={setTrustViewMode}
            />
            <PerformancePanel metrics={result.performance} />
          </div>

          <AnswerCard
            query={lastSubmittedQuery}
            answer={result.answer}
            citations={result.citations}
            contextTrace={result.contextTrace}
            showRawContext={showRawContext}
            onToggleRawContext={setShowRawContext}
          />

          <SourcesPanel
            sources={result.retrieved}
            showDebugScores={showDebugScores}
            onToggleDebugScores={setShowDebugScores}
          />
        </>
      )}
    </main>
  );
}
