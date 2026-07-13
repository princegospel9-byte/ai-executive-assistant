'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { createMeeting, saveMeetingAudio, processMeeting } from '@/app/(dashboard)/voice/actions';

export function MeetingRecorder() {
  const [title, setTitle] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const meetingIdRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  async function handleStart() {
    if (!title.trim()) {
      setError('Give the meeting a title first.');
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      meetingIdRef.current = await createMeeting(title.trim());

      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setIsRecording(true);
      setStatus('Recording — with your consent, this captures audio for the whole meeting.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start recording.');
    }
  }

  function handleStop() {
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
    setStatus('Transcribing and summarizing…');

    startTransition(async () => {
      try {
        const meetingId = meetingIdRef.current!;
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

        const formData = new FormData();
        formData.set('file', blob, 'meeting.webm');
        const transcribeResponse = await fetch('/api/voice/transcribe', { method: 'POST', body: formData });
        const transcribeResult = await transcribeResponse.json();
        if (!transcribeResponse.ok) throw new Error(transcribeResult.error || 'Transcription failed.');

        const audioFormData = new FormData();
        audioFormData.set('file', blob, 'meeting.webm');
        await saveMeetingAudio(meetingId, audioFormData).catch(() => {
          // Audio archival is best-effort - the transcript/summary flow below doesn't depend on it.
        });

        await processMeeting(meetingId, transcribeResult.text || '');
        setStatus('Meeting summarized — see it below.');
        setTitle('');
      } catch (err) {
        setStatus(null);
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Meeting assistant</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Records audio only with your explicit start here. Generates a transcript, summary, decisions, and action items
        (as real tasks) when you stop.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Meeting title"
          disabled={isRecording || isProcessing}
          className="h-9 flex-1 min-w-[10rem] rounded-md border border-neutral-300 bg-white px-3 text-sm"
        />
        {!isRecording ? (
          <Button onClick={handleStart} disabled={isProcessing}>
            {isProcessing ? 'Processing…' : 'Start meeting'}
          </Button>
        ) : (
          <Button variant="outline" onClick={handleStop}>
            End meeting
          </Button>
        )}
      </div>
      {status && <p className="mt-2 text-xs text-neutral-500">{status}</p>}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}