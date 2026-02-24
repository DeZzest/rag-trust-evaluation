import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCollectionSuggestions,
  getDefaultCollectionId,
  getDefaultQueryTimeoutMs,
  getStrictTrustScore,
  queryRag,
  toPercent,
} from "../api/rag";
import { AnswerCard } from "../components/AnswerCard";
import { HistoryPanel } from "../components/HistoryPanel";
import { PerformancePanel } from "../components/PerformancePanel";
import { QueryInput } from "../components/QueryInput";
import { SourcesPanel } from "../components/SourcesPanel";
import { TrustPanel } from "../components/TrustPanel";
import {
  QueryInputValues,
  RagQueryPayload,
  RagQueryResponse,
  SavedConversation,
  StoredRagResult,
  ThemeMode,
  TrustViewMode,
} from "../types/rag.types";

const QUICK_QUERIES = [
  "What documents are required for master admission?",
  "What does the academic integrity policy include?",
  "How is scholarship assignment regulated?",
  "Where can I find information about the university infrastructure?",
];

const HISTORY_STORAGE_KEY = "rag_dashboard_history_v1";
const THEME_STORAGE_KEY = "rag_dashboard_theme_v1";
const HISTORY_LIMIT = 20;
const NOTICE_LIFETIME_MS = 1800;
const SLOW_REQUEST_THRESHOLD_MS = 8000;

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
      <section className="panel skeleton-panel">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
        <div className="skeleton-line" />
      </section>
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

function toStoredResult(result: RagQueryResponse): StoredRagResult {
  return {
    answer: result.answer,
    citations: result.citations,
    collectionId: result.collectionId,
    retrieved: result.retrieved,
    contextTrace: result.contextTrace,
    citationValidation: result.citationValidation,
    trust: result.trust,
    performance: result.performance,
  };
}

function fromStoredResult(stored: StoredRagResult): RagQueryResponse {
  return {
    ...stored,
    raw: null,
  };
}

function createConversation(payload: RagQueryPayload, result: RagQueryResponse): SavedConversation {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    payload: {
      query: payload.query,
      collectionId: payload.collectionId,
      topK: payload.topK,
      includeFaithfulness: payload.includeFaithfulness,
    },
    result: toStoredResult(result),
  };
}

function parseSavedHistory(rawValue: string | null): SavedConversation[] {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === "object")
      .filter(
        (item) =>
          typeof item.id === "string" &&
          typeof item.createdAt === "string" &&
          item.payload &&
          typeof item.payload.query === "string" &&
          typeof item.payload.collectionId === "string" &&
          item.result &&
          typeof item.result.answer === "string"
      ) as SavedConversation[];
  } catch {
    return [];
  }
}

function loadTheme(): ThemeMode {
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? "dark" : "light";
}

function downloadFile(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFilenamePart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 42);
  return normalized || "rag-answer";
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function RagPage() {
  const [form, setForm] = useState<QueryInputValues>(initialForm);
  const [result, setResult] = useState<RagQueryResponse | null>(null);
  const [lastSubmittedQuery, setLastSubmittedQuery] = useState("");
  const [lastPayload, setLastPayload] = useState<RagQueryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRawContext, setShowRawContext] = useState(false);
  const [showDebugScores, setShowDebugScores] = useState(false);
  const [trustViewMode, setTrustViewMode] = useState<TrustViewMode>("backend");
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<SavedConversation[]>(() =>
    parseSavedHistory(window.localStorage.getItem(HISTORY_STORAGE_KEY))
  );
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const abortRef = useRef<AbortController | null>(null);

  const backendScore = result?.trust.score ?? 0;
  const displayedScore =
    result && trustViewMode === "strict"
      ? getStrictTrustScore(
          result.trust.score,
          result.citationValidation.coverage,
          result.citationValidation.citationValidity
        )
      : backendScore;

  const isSlowRequest = loading && elapsedMs >= SLOW_REQUEST_THRESHOLD_MS;

  const statusText = useMemo(() => {
    if (loading && isSlowRequest) {
      return `Still processing... ${formatDuration(elapsedMs)} elapsed.`;
    }
    if (loading) return "Running retrieval, generation, and trust validation...";
    if (error && result) {
      return "Latest refresh failed. Last successful result is still visible.";
    }
    if (error) return error;
    if (!result) {
      return "Submit a query to inspect answer quality, sources, trust, and latency.";
    }
    if (result.citationValidation.isValid) {
      return "Response generated with valid citation coverage.";
    }
    return "Response generated with citation warnings. Check the trust panel for details.";
  }, [elapsedMs, error, isSlowRequest, loading, result]);

  const utf8Hint = useMemo(() => {
    if (!error) return null;
    return error.toLowerCase().includes("utf-8")
      ? "Hint: verify UTF-8 request payload if you query the backend manually."
      : null;
  }, [error]);

  useEffect(() => {
    if (!loading) {
      setElapsedMs(0);
      return;
    }
    const startAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startAt);
    }, 250);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const saveToHistory = (payload: RagQueryPayload, response: RagQueryResponse) => {
    const conversation = createConversation(payload, response);
    setHistory((prev) => [conversation, ...prev].slice(0, HISTORY_LIMIT));
    setActiveHistoryId(conversation.id);
    return conversation;
  };

  const runQuery = async (payload: RagQueryPayload) => {
    if (!payload.query.trim()) {
      setError("Field 'query' cannot be empty.");
      return;
    }
    if (!payload.collectionId.trim()) {
      setError("Field 'collectionId' is required.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setLastPayload(payload);
    setLastSubmittedQuery(payload.query.trim());
    setShowRawContext(false);
    setShowDebugScores(false);

    try {
      const response = await queryRag(payload, {
        signal: controller.signal,
        timeoutMs: getDefaultQueryTimeoutMs(),
      });
      setResult(response);
      saveToHistory(payload, response);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Request failed.";
      setError(message);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    await runQuery({
      query: form.query,
      collectionId: form.collectionId,
      topK: form.topK,
      includeFaithfulness: form.includeFaithfulness,
    });
  };

  const handleRetry = async () => {
    if (!lastPayload) return;
    await runQuery(lastPayload);
  };

  const handleCancelRequest = () => {
    abortRef.current?.abort();
  };

  const handleLoadConversation = (entry: SavedConversation) => {
    setForm({
      query: entry.payload.query,
      collectionId: entry.payload.collectionId,
      topK: entry.payload.topK ?? 3,
      includeFaithfulness: entry.payload.includeFaithfulness ?? false,
    });
    setResult(fromStoredResult(entry.result));
    setLastSubmittedQuery(entry.payload.query);
    setLastPayload(entry.payload);
    setActiveHistoryId(entry.id);
    setError(null);
    setNotice("Conversation loaded from history.");
  };

  const handleRunConversation = async (entry: SavedConversation) => {
    setForm({
      query: entry.payload.query,
      collectionId: entry.payload.collectionId,
      topK: entry.payload.topK ?? 3,
      includeFaithfulness: entry.payload.includeFaithfulness ?? false,
    });
    await runQuery(entry.payload);
  };

  const handleDeleteConversation = (id: string) => {
    setHistory((prev) => prev.filter((entry) => entry.id !== id));
    if (activeHistoryId === id) {
      setActiveHistoryId(null);
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    setActiveHistoryId(null);
    setNotice("History cleared.");
  };

  const handleSaveConversation = () => {
    if (!result || !lastPayload) return;
    saveToHistory(lastPayload, result);
    setNotice("Conversation saved.");
  };

  const handleExportTxt = () => {
    if (!result || !lastPayload) return;
    const timestamp = new Date().toISOString();
    const base = safeFilenamePart(lastPayload.query);
    const content = [
      `Query: ${lastPayload.query}`,
      `Collection: ${lastPayload.collectionId}`,
      `TopK: ${lastPayload.topK ?? 3}`,
      `Trust score: ${toPercent(result.trust.score)}`,
      `Coverage: ${toPercent(result.citationValidation.coverage)}`,
      `Validity: ${toPercent(result.citationValidation.citationValidity)}`,
      `Total latency: ${result.performance.totalMs} ms`,
      "",
      "Answer:",
      result.answer,
      "",
      `Citations: ${
        result.citations.length > 0
          ? result.citations.map((citation) => `[${citation}]`).join(", ")
          : "none"
      }`,
      "",
      `Exported at: ${timestamp}`,
    ].join("\n");

    downloadFile(`${base}.txt`, "text/plain;charset=utf-8", content);
    setNotice("TXT exported.");
  };

  const handleExportJson = () => {
    if (!result || !lastPayload) return;
    const base = safeFilenamePart(lastPayload.query);
    const payload = {
      exportedAt: new Date().toISOString(),
      request: lastPayload,
      result: toStoredResult(result),
    };
    downloadFile(`${base}.json`, "application/json;charset=utf-8", JSON.stringify(payload, null, 2));
    setNotice("JSON exported.");
  };

  return (
    <main className="rag-shell">
      <header className="panel hero">
        <div className="hero-main">
          <p className="eyebrow">RAG Trust Evaluation</p>
          <h1 className="hero-title">LUTE RAG Dashboard</h1>
          <p className="status-text">{statusText}</p>
          {notice && <p className="notice-text">{notice}</p>}
        </div>
        <div className="hero-side">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          {loading && (
            <button type="button" className="secondary-btn" onClick={handleCancelRequest}>
              Cancel request
            </button>
          )}
          <span className="badge badge-hero">Collection: {form.collectionId || "n/a"}</span>
          <span className="badge badge-hero">TopK: {form.topK}</span>
          <span className="badge badge-hero">Timeout: {getDefaultQueryTimeoutMs()} ms</span>
          {loading && <span className="badge badge-hero">Elapsed: {formatDuration(elapsedMs)}</span>}
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

      <HistoryPanel
        entries={history}
        activeId={activeHistoryId}
        onLoad={handleLoadConversation}
        onRun={handleRunConversation}
        onDelete={handleDeleteConversation}
        onClear={handleClearHistory}
      />

      {error && (
        <section className="panel alert-panel" role="alert">
          <div className="panel-row">
            <div>
              <h2 className="panel-title">Request Error</h2>
              <p className="error-text">{error}</p>
              {utf8Hint && <p className="muted-text">{utf8Hint}</p>}
            </div>
            <div className="inline-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={handleRetry}
                disabled={!lastPayload || loading}
              >
                Retry
              </button>
            </div>
          </div>
        </section>
      )}

      {loading && !result && <ResultSkeleton />}

      {!loading && !result && !error && (
        <section className="panel empty-panel">
          <h2 className="panel-title">Awaiting Query</h2>
          <p className="panel-subtitle">
            Start with one of the quick prompts above or enter your own question.
          </p>
        </section>
      )}

      {result && (
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
            invalidCitations={result.citationValidation.invalidCitations}
            contextTrace={result.contextTrace}
            showRawContext={showRawContext}
            onToggleRawContext={setShowRawContext}
            onSaveConversation={handleSaveConversation}
            onExportTxt={handleExportTxt}
            onExportJson={handleExportJson}
          />

          <SourcesPanel
            loading={loading}
            sources={result.retrieved}
            showDebugScores={showDebugScores}
            onToggleDebugScores={setShowDebugScores}
          />
        </>
      )}
    </main>
  );
}
