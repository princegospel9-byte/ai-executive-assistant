'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { askAdvisor } from '@/app/(dashboard)/assistant/actions';

const EXAMPLE_QUESTIONS = [
  'Which schools should I follow up with this week?',
  'What features does SchoolPro GH provide?',
  'Why are customers not converting?',
  'What processes can be automated?',
];

type Message = {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
};

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAsk(q: string) {
    const text = q.trim();
    if (!text) return;
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setQuestion('');
    startTransition(async () => {
      try {
        const result = await askAdvisor(text);
        setMessages((prev) => [...prev, { role: 'assistant', content: result.answer, sources: result.sources }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4">
        {messages.length === 0 && (
          <div>
            <p className="text-sm text-neutral-500">
              Ask about your documents, pipeline, tasks, or business — grounded only in what&apos;s actually in your
              Knowledge Base and CRM.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLE_QUESTIONS.map((q) => (
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
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask your AI Advisor…"
          className="h-10 flex-1 rounded-md border border-neutral-300 bg-white px-3 text-sm"
        />
        <Button type="submit" disabled={isPending}>
          Ask
        </Button>
      </form>
    </div>
  );
}