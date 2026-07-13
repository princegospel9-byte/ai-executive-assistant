let currentAudio: HTMLAudioElement | null = null;

// Stops any currently-playing response first - this is the client-side half
// of "handle interruptions gracefully": a new utterance or a new speak()
// call should always cut off whatever the assistant was saying.
export async function playTts(text: string): Promise<void> {
  currentAudio?.pause();

  const response = await fetch('/api/voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ error: 'Speech generation failed.' }));
    throw new Error(result.error || 'Speech generation failed.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  await audio.play();
}

export function stopTts(): void {
  currentAudio?.pause();
  currentAudio = null;
}