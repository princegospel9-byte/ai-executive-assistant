'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MicButton } from '@/components/voice/mic-button';
import { playTts } from '@/lib/voice/play-tts';
import {
  askAdvisor,
  orchestrateRequest,
  decideAgentOutput,
  startVoiceSession,
  logVoiceTranscript,
  endVoiceSession,
  type AgentRun,
} from '@/app/(dashboard)/assistant/actions';

const EXAMPLE_QUESTIONS = [
  'Which schools should I follow up with this week?',
  'What features does SchoolPro GH provide?',
  'Why are customers not converting?',
  'What processes can be automated?',
];

const EXAMPLE_DELEGATIONS = [
  'Prepare a plan to get 20 new schools using SchoolPro GH.',
  'Help me increase SchoolPro GH customers.',
];

type Message = {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  agentRuns?: AgentRun[];
};

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<'ask' | 'delegate'>('ask');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (sessionIdRef.current) endVoiceSession(sessionIdRef.current);
    };
  }, []);

  async function ensureSession() {
    if (!sessionIdRef.current) {
      sessionIdRef.current = await startVoiceSession('conversation');
    }
    return sessionIdRef.current;
  }

  function handleAsk(q: string, useMode: 'ask' | 'delegate' = mode) {
    const text = q.trim();
    if (!text) return;
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setQuestion('');
    startTransition(async () => {
      try {
        if (voiceEnabled) {
          const sessionId = await ensureSession();
          await logVoiceTranscript(sessionId, 'user', text);
        }

        let responseText: string;
        if (useMode === 'delegate') {
          const result = await orchestrateRequest(text);
          responseText = result.combined_result;
          setMessages((prev) => [...prev, { role: 'assistant', content: result.combined_result, agentRuns: result.agent_runs }]);
        } else {
          const result = await askAdvisor(text);
          responseText = result.answer;
          setMessages((prev) => [...prev, { role: 'assistant', content: result.answer, sources: result.sources }]);
        }

        if (voiceEnabled) {
          const sessionId = await ensureSession();
          await logVoiceTranscript(sessionId, 'assistant', responseText);
          try {
            await playTts(responseText);
          } catch {
            // Speech playback failing shouldn't block the text response already shown.
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  function handleDecision(approvalId: string, decision: 'approved' | 'rejected', index: number) {
    startTransition(async () => {
      try {
        await decideAgentOutput(approvalId, decision);
        setMessages((prev) =>
          prev.map((m, i) =>
            i === index
              ? {
                  ...m,
                  agentRuns: m.agentRuns?.map((r) => (r.approval_id === approvalId ? { ...r, requires_approval: false } : r)),
                }
              : m
          )
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  const examples = mode === 'delegate' ? EXAMPLE_DELEGATIONS : EXAMPLE_QUESTIONS;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button
            onClick={() => setMode('ask')}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${mode === 'ask' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50'}`}
          >
            Ask
          </button>
          <button
            onClick={() => setMode('delegate')}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${mode === 'delegate' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50'}`}
          >
            Delegate to agent team
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-neutral-600">
          <input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} />
          Voice mode (speaks replies aloud)
        </label>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-neutral-500">
              {mode === 'delegate'
                ? 'Describe a goal - the Executive Assistant will decide which agents should help and combine their recommendations.'
                : "Ask about your documents, pipeline, tasks, or business — grounded only in what's actually in your Knowledge Base and CRM."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {examples.map((q) => (
                <button
                  key={q}
                  onClick={() => handleAsk(q)}
                  className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-left ${
                m.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-800'
              }`}
            >
              {m.content}
            </div>
            {m.sources && m.sources.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {m.sources.map((s) => (
                  <Badge key={s} variant="secondary">
                    {s}
                  </Badge>
                ))}
              </div>
            )}
            {m.agentRuns && m.agentRuns.length > 0 && (
              <div className="mt-2 space-y-2 text-left">
                {m.agentRuns.map((run) => (
                  <div key={run.agent_key} className="rounded-md border border-neutral-200 bg-neutral-50 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary">{run.agent_name}</Badge>
                      {run.requires_approval && run.approval_id && (
                        <div className="flex gap-1">
                          <Button onClick={() => handleDecision(run.approval_id!, 'approved', i)} disabled={isPending}>
                            Approve
                          </Button>
                          <Button variant="outline" onClick={() => handleDecision(run.approval_id!, 'rejected', i)} disabled={isPending}>
                            Reject
                          </Button>
                        </div>
                      )}
                      {!run.requires_approval && <span className="text-xs text-neutral-400">info</span>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700">{run.output_text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {isPending && <p className="text-xs text-neutral-400">Thinking…</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAsk(question);
        }}
        className="mt-3 flex gap-2"
      >
        <MicButton onTranscript={(text) => handleAsk(text)} disabled={isPending} />
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={mode === 'delegate' ? 'Describe a goal for the agent team…' : 'Ask your AI Advisor…'}
          className="h-10 flex-1 rounded-md border border-neutral-300 bg-white px-3 text-sm"
        />
        <Button type="submit" disabled={isPending}>
          {mode === 'delegate' ? 'Delegate' : 'Ask'}
        </Button>
      </form>
    </div>
  );
}