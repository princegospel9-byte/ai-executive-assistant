'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { MicButton } from '@/components/voice/mic-button';
import { dictate } from '@/app/(dashboard)/voice/actions';

const TARGET_TYPES = [
  ['email', 'Email'],
  ['report', 'Report'],
  ['meeting_notes', 'Meeting notes'],
  ['blog_post', 'Blog post'],
  ['customer_response', 'Customer response'],
] as const;

export function DictationPanel() {
  const [targetType, setTargetType] = useState('email');
  const [rawText, setRawText] = useState('');
  const [cleaned, setCleaned] = useState<{ text: string; needsClarification: boolean; note: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClean(text?: string) {
    const source = (text ?? rawText).trim();
    if (!source) return;
    setError(null);
    setRawText(source);
    startTransition(async () => {
      try {
        const result = await dictate(source, targetType);
        setCleaned({ text: result.cleaned_text, needsClarification: result.needs_clarification, note: result.clarification_note });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  function handleCopy() {
    if (cleaned) navigator.clipboard.writeText(cleaned.text);
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Smart dictation</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Speak or type, pick a format, and Claude cleans up grammar and formatting while preserving what you actually said.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={targetType} onChange={(e) => setTargetType(e.target.value)} className="h-9 rounded-md border border-neutral-300 bg-white px-3 text-sm">
          {TARGET_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <MicButton onTranscript={(text) => handleClean(rawText ? `${rawText} ${text}` : text)} disabled={isPending} />
      </div>
      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder="Dictated or typed text appears here — edit freely before cleaning up."
        rows={4}
        className="mt-2 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <Button onClick={() => handleClean()} disabled={isPending}>
          {isPending ? 'Cleaning up…' : 'Clean up'}
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {cleaned && (
        <div className="mt-3 rounded-md bg-neutral-50 p-3">
          <p className="whitespace-pre-wrap text-sm text-neutral-700">{cleaned.text}</p>
          {cleaned.needsClarification && cleaned.note && (
            <p className="mt-2 text-xs text-amber-600">Needs clarification: {cleaned.note}</p>
          )}
          <Button variant="outline" onClick={handleCopy} className="mt-2">
            Copy
          </Button>
        </div>
      )}
    </div>
  );
}