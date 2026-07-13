import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Proxies ElevenLabs speech-to-text so the API key never reaches the
// browser. Batch (file upload), not streaming - ElevenLabs' STT endpoint is
// a one-shot transcription, so the browser records an utterance (stops on
// silence or a manual tap) and posts the whole clip here.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ELEVENLABS_API_KEY is not configured in .env.local.' }, { status: 500 });
  }

  const incomingForm = await request.formData();
  const audioFile = incomingForm.get('file');
  if (!audioFile || !(audioFile instanceof Blob)) {
    return NextResponse.json({ error: 'No audio file provided.' }, { status: 400 });
  }

  const outgoingForm = new FormData();
  outgoingForm.set('model_id', 'scribe_v1');
  outgoingForm.set('file', audioFile, 'utterance.webm');

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: outgoingForm,
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json({ error: `ElevenLabs STT failed (${response.status}): ${text}` }, { status: 502 });
  }

  const result = await response.json();
  return NextResponse.json({ text: result.text || '' });
}