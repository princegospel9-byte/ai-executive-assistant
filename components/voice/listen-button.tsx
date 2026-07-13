'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { playTts, stopTts } from '@/lib/voice/play-tts';

export function ListenButton({ text }: { text: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (isPlaying) {
      stopTts();
      setIsPlaying(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        setIsPlaying(true);
        await playTts(text);
        setIsPlaying(false);
      } catch (err) {
        setIsPlaying(false);
        setError(err instanceof Error ? err.message : 'Could not play audio.');
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button variant="outline" onClick={handleClick} disabled={isPending && !isPlaying}>
        {isPlaying ? '⏹ Stop' : '🔊 Listen'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}