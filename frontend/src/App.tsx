import { useMemo, useState } from "react";
import { askQuestion, evaluateQuestion } from "./api";
import { AnswerCard } from "./components/AnswerCard";
import { MetricsPanel } from "./components/MetricsPanel";
import { QueryForm, QueryFormValues } from "./components/QueryForm";
import { SourcesList } from "./components/SourcesList";
import { TrustBar } from "./components/TrustBar";
import { Metrics, RAGResponse } from "./types";

const initialForm: QueryFormValues = {
  query: "",
  collectionId: "",
  topK: 3,
  groundTruth: "",
};

function App() {
  const [form, setForm] = useState<QueryFormValues>(initialForm);
  const [result, setResult] = useState<RAGResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAsk = async () => {
    if (!form.query.trim()) {
      setError("Question cannot be empty.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const queryResult = await askQuestion({
        query: form.query,
        collectionId: form.collectionId,
        topK: form.topK,
      });

      const relevantDocumentIds = queryResult.retrieved.map((source) => source.documentId);
      const evaluation = await evaluateQuestion({
        query: form.query,
        collectionId: form.collectionId,
        relevantDocumentIds,
        groundTruth: form.groundTruth,
      });

      const mergedMetrics: Metrics = {
        ...queryResult.metrics,
        evaluationTrustScore: evaluation?.trustScore,
        retrievalPrecision: evaluation?.retrievalPrecision,
        retrievalRecall: evaluation?.retrievalRecall,
        averageSimilarity: evaluation?.averageSimilarity,
        faithfulness: evaluation?.faithfulness ?? queryResult.metrics.faithfulness,
        answerSimilarity: evaluation?.answerSimilarity,
        diagnosis: evaluation?.diagnosis,
      };

      setResult({
        ...queryResult,
        metrics: mergedMetrics,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const statusText = useMemo(() => {
    if (loading) return "Generating answer and evaluation...";
    if (error) return error;
    if (!result) return "Submit a question to see trust-aware output.";
    if (result.citationValidation?.isValid) {
      return "Citations validated successfully.";
    }
    return "Answer returned with citation warnings.";
  }, [loading, error, result]);

  return (
    <main className="dashboard">
      <header className="hero panel">
        <p className="eyebrow">Trust-Aware RAG</p>
        <h1 className="app-title">University Policy Assistant</h1>
        <p className="status-text">{statusText}</p>
      </header>

      <QueryForm
        values={form}
        loading={loading}
        onChange={setForm}
        onSubmit={handleAsk}
      />

      {result && (
        <>
          <div className="split-grid">
            <TrustBar value={result.trustScore} />
            <MetricsPanel metrics={result.metrics} />
          </div>
          <AnswerCard answer={result.answer} citations={result.citations} />
          <SourcesList sources={result.retrieved} />
        </>
      )}
    </main>
  );
}

export default App;
