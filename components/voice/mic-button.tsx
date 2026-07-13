'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

// Push-to-talk, not continuous listening with silence detection - simpler
// and more reliable than voice-activity-detection heuristics, and avoids
// false starts/stops. Tap to start, tap again to stop.
export function MicButton({
  onTranscript,
  disabled,
}: {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      setError('Microphone access was denied or is unavailable.');
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
  }

  async function handleStop() {
    setIsTranscribing(true);
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const formData = new FormData();
      formData.set('file', blob, 'utterance.webm');
      const response = await fetch('/api/voice/transcribe', { method: 'POST', body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Transcription failed.');
      if (result.text?.trim()) onTranscript(result.text.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsTranscribing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={isRecording ? 'default' : 'outline'}
        onClick={isRecording ? stopRecording : startRecording}
        disabled={disabled || isTranscribing}
      >
        {isRecording ? '⏹ Stop' : isTranscribing ? 'Transcribing…' : '🎤 Speak'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}