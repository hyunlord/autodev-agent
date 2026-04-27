'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AIBuilderResult, ConversationTurn, ClarificationQuestion } from '@/lib/ai-builder/types';
import { CodeBlock } from '@/app/tasks/[id]/components/CodeBlock';

type ModalStep = 'input' | 'loading' | 'result' | 'clarify' | 'saving';

const LOADING_STAGES = [
  'Classifying intent...',
  'Assembling context...',
  'Generating YAML...',
  'Validating result...',
];

interface AIBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  currentYaml?: string;
  onSaveSuccess?: () => void;
}

export function AIBuilderModal({ isOpen, onClose, projectId, currentYaml, onSaveSuccess }: AIBuilderModalProps) {
  const [step, setStep] = useState<ModalStep>('input');
  const [userMessage, setUserMessage] = useState('');
  const [result, setResult] = useState<AIBuilderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingStage, setLoadingStage] = useState(LOADING_STAGES[0]);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<Record<number, string>>({});

  // ESC key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'loading' && step !== 'saving') {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, step, onClose]);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('input');
      setUserMessage('');
      setResult(null);
      setError(null);
      setConversationHistory([]);
      setClarifyAnswers({});
    }
  }, [isOpen]);

  const startLoadingRotation = useCallback(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    LOADING_STAGES.forEach((stage, i) => {
      const t = setTimeout(() => {
        setLoadingStage(stage);
      }, i * 5000);
      timers.push(t);
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  const handleGenerate = useCallback(async (overrideHistory?: ConversationTurn[]) => {
    setStep('loading');
    setError(null);
    setLoadingStage(LOADING_STAGES[0]);
    const stopRotation = startLoadingRotation();

    const historyToSend = overrideHistory ?? conversationHistory;

    try {
      const response = await fetch('/api/ai-builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          userMessage,
          currentYaml,
          conversationHistory: historyToSend.length > 0 ? historyToSend : undefined,
        }),
      });

      stopRotation();

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as { error?: string } | null;
        setError(errBody?.error ?? 'AI_BUILDER_FAILED');
        setStep('input');
        return;
      }

      const body = await response.json() as { data: AIBuilderResult };
      const data = body.data;
      setResult(data);

      if (data.needsClarification && data.clarificationQuestions && data.clarificationQuestions.length > 0) {
        setStep('clarify');
      } else {
        setStep('result');
      }
    } catch (err) {
      stopRotation();
      setError(err instanceof Error ? err.message : 'NETWORK_ERROR');
      setStep('input');
    }
  }, [projectId, userMessage, currentYaml, conversationHistory, startLoadingRotation]);

  const handleSave = async () => {
    if (!result?.generatedYaml) return;
    setStep('saving');
    setError(null);

    try {
      const response = await fetch('/api/pipeline-versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          yaml: result.generatedYaml,
          changeSource: 'ai_edit',
        }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as { error?: string } | null;
        setError(errBody?.error ?? 'SAVE_FAILED');
        setStep('result');
        return;
      }

      onSaveSuccess?.();
      onClose();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NETWORK_ERROR');
      setStep('result');
    }
  };

  const handleClarifySubmit = () => {
    if (!result) return;
    const questions = result.clarificationQuestions ?? [];
    const answersText = questions
      .map((q, i) => `Q: ${q.question}\nA: ${clarifyAnswers[i] ?? ''}`)
      .join('\n\n');

    const clarifyQuestionsSummary = questions.map(q => q.question).join('; ');
    const newHistory: ConversationTurn[] = [
      ...conversationHistory,
      { role: 'assistant', content: `${result.explanation}\n\nClarification needed: ${clarifyQuestionsSummary}` },
      { role: 'user', content: answersText },
    ];
    setConversationHistory(newHistory);
    handleGenerate(newHistory);
  };

  if (!isOpen) return null;

  const canClose = step !== 'loading' && step !== 'saving';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={canClose ? onClose : undefined}
    >
      <div
        className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border shadow-2xl"
        style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: 'var(--border-color)' }}
        >
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            AI Builder
          </h2>
          {canClose && (
            <button
              onClick={onClose}
              className="text-sm px-2 py-1 rounded hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-secondary)' }}
            >
              &#x2715;
            </button>
          )}
        </div>

        {/* Error banner (always visible above content) */}
        {error && (
          <div className="mx-6 mt-4 px-4 py-3 rounded-xl border border-red-800 bg-red-900/20 flex items-start justify-between gap-3">
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="text-xs text-red-400 hover:opacity-70 transition-opacity shrink-0">&#x2715;</button>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4">
          {step === 'input' && (
            <StepInput
              userMessage={userMessage}
              setUserMessage={setUserMessage}
              currentYaml={currentYaml}
              onGenerate={() => handleGenerate()}
            />
          )}

          {step === 'loading' && (
            <StepLoading loadingStage={loadingStage} />
          )}

          {step === 'result' && result && (
            <StepResult
              result={result}
              currentYaml={currentYaml}
              onSave={handleSave}
              onDiscard={onClose}
            />
          )}

          {step === 'clarify' && result && (
            <StepClarify
              result={result}
              clarifyAnswers={clarifyAnswers}
              setClarifyAnswers={setClarifyAnswers}
              onSubmit={handleClarifySubmit}
              onCancel={onClose}
            />
          )}

          {step === 'saving' && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div
                className="w-8 h-8 border-2 rounded-full animate-spin"
                style={{ borderColor: 'var(--border-color)', borderTopColor: '#6366f1' }}
              />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Saving pipeline version...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function StepInput({
  userMessage,
  setUserMessage,
  currentYaml,
  onGenerate,
}: {
  userMessage: string;
  setUserMessage: (v: string) => void;
  currentYaml?: string;
  onGenerate: () => void;
}) {
  return (
    <div className="space-y-4">
      <textarea
        value={userMessage}
        onChange={(e) => setUserMessage(e.target.value)}
        placeholder="Describe the pipeline you want to create or modify..."
        rows={4}
        className="w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border-color)',
          color: 'var(--text-primary)',
        }}
      />

      {currentYaml && (
        <details className="text-sm">
          <summary className="cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            Current YAML (context)
          </summary>
          <div className="mt-2">
            <CodeBlock code={currentYaml} language="yaml" maxHeight={200} showLineNumbers={false} />
          </div>
        </details>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onGenerate}
          disabled={!userMessage.trim()}
          className="px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: userMessage.trim() ? '#6366f1' : undefined,
            color: userMessage.trim() ? '#fff' : 'var(--text-secondary)',
            border: userMessage.trim() ? 'none' : '1px solid var(--border-color)',
          }}
        >
          Generate
        </button>
      </div>
    </div>
  );
}

function StepLoading({ loadingStage }: { loadingStage: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div
        className="w-8 h-8 border-2 rounded-full animate-spin"
        style={{ borderColor: 'var(--border-color)', borderTopColor: '#6366f1' }}
      />
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{loadingStage}</p>
    </div>
  );
}

const INTENT_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: 'new', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
  modify: { label: 'modify', color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  explain: { label: 'explain', color: '#60a5fa', bg: 'rgba(96,165,250,0.1)' },
  clarify: { label: 'clarify', color: '#c084fc', bg: 'rgba(192,132,252,0.1)' },
};

function StepResult({
  result,
  currentYaml,
  onSave,
  onDiscard,
}: {
  result: AIBuilderResult;
  currentYaml?: string;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const badge = INTENT_BADGE[result.intent] ?? INTENT_BADGE['explain'];
  const hasDiff = result.intent === 'modify' && result.diff && currentYaml;
  const hasYaml = !!result.generatedYaml;

  return (
    <div className="space-y-4">
      {/* Intent badge */}
      <div className="flex items-center gap-2">
        <span
          className="inline-block px-2 py-0.5 text-xs font-medium rounded-full"
          style={{ color: badge.color, background: badge.bg }}
        >
          {badge.label}
        </span>
      </div>

      {/* Explanation */}
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{result.explanation}</p>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="px-4 py-3 rounded-xl border border-amber-800 bg-amber-900/20">
          <p className="text-xs font-medium text-amber-400 mb-1">Warnings</p>
          <ul className="list-disc list-inside space-y-0.5">
            {result.warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-400">{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Diff summary banner */}
      {hasDiff && result.diff && (
        <div
          className="flex gap-4 px-4 py-2 rounded-lg border text-xs"
          style={{ borderColor: 'var(--border-color)', background: 'var(--bg-secondary)' }}
        >
          {result.diff.addedNodes.length > 0 && (
            <span className="text-green-400">+{result.diff.addedNodes.length} added</span>
          )}
          {result.diff.removedNodes.length > 0 && (
            <span className="text-red-400">-{result.diff.removedNodes.length} removed</span>
          )}
          {result.diff.modifiedNodes.length > 0 && (
            <span className="text-amber-400">~{result.diff.modifiedNodes.length} modified</span>
          )}
        </div>
      )}

      {/* YAML display: side-by-side diff or single panel */}
      {hasDiff && currentYaml && result.generatedYaml ? (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Before</p>
            <CodeBlock code={currentYaml} language="yaml" maxHeight={400} showLineNumbers={false} />
          </div>
          <div>
            <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>After</p>
            <CodeBlock code={result.generatedYaml} language="yaml" maxHeight={400} showLineNumbers={false} />
          </div>
        </div>
      ) : hasYaml && result.generatedYaml ? (
        <CodeBlock code={result.generatedYaml} language="yaml" maxHeight={500} />
      ) : null}

      {/* Suggested next steps */}
      {result.suggestedNextSteps && result.suggestedNextSteps.length > 0 && (
        <div>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Suggested next steps</p>
          <ul className="list-disc list-inside space-y-0.5">
            {result.suggestedNextSteps.map((s, i) => (
              <li key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Cost info */}
      {(result.totalCostUsd !== undefined || result.attempts > 0) && (
        <p className="text-xs text-right" style={{ color: 'var(--text-secondary)' }}>
          {result.totalCostUsd !== undefined && `$${result.totalCostUsd.toFixed(4)} \u2022 `}
          {result.inputTokens !== undefined && result.outputTokens !== undefined
            ? `${result.inputTokens}+${result.outputTokens} tokens \u2022 `
            : ''}
          {result.attempts} attempt{result.attempts !== 1 ? 's' : ''}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <button
          onClick={onDiscard}
          className="px-4 py-2 text-sm rounded-lg border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
        >
          Discard
        </button>
        {hasYaml && (
          <button
            onClick={onSave}
            className="px-4 py-2 text-sm rounded-lg transition-colors hover:opacity-80"
            style={{ background: '#6366f1', color: '#fff' }}
          >
            Save
          </button>
        )}
      </div>
    </div>
  );
}

function StepClarify({
  result,
  clarifyAnswers,
  setClarifyAnswers,
  onSubmit,
  onCancel,
}: {
  result: AIBuilderResult;
  clarifyAnswers: Record<number, string>;
  setClarifyAnswers: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const questions: ClarificationQuestion[] = result.clarificationQuestions ?? [];
  const allRequired = questions.every((q, i) => !q.isRequired || !!clarifyAnswers[i]?.trim());

  return (
    <div className="space-y-6">
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{result.explanation}</p>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={i} className="space-y-2">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {q.question}
              {q.isRequired && <span className="text-red-400 ml-1">*</span>}
            </p>
            {q.options && q.options.length > 0 ? (
              <div className="space-y-1">
                {q.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={`clarify-${i}`}
                      value={opt}
                      checked={clarifyAnswers[i] === opt}
                      onChange={() => setClarifyAnswers((prev) => ({ ...prev, [i]: opt }))}
                      className="accent-indigo-500"
                    />
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{opt}</span>
                  </label>
                ))}
              </div>
            ) : (
              <input
                type="text"
                value={clarifyAnswers[i] ?? ''}
                onChange={(e) => setClarifyAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
                placeholder="Your answer..."
                className="w-full px-3 py-2 text-sm rounded-lg border focus:outline-none focus:ring-1 focus:ring-indigo-500"
                style={{
                  background: 'var(--bg-secondary)',
                  borderColor: 'var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm rounded-lg border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={!allRequired}
          className="px-4 py-2 text-sm rounded-lg transition-colors hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#6366f1', color: '#fff' }}
        >
          Submit Answers &amp; Regenerate
        </button>
      </div>
    </div>
  );
}
