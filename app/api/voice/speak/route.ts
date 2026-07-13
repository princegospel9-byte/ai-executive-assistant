import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Default: "Rachel", one of ElevenLabs' premade voices - overridden per-user
// by voice_preferences.elevenlabs_voice_id if set.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

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

  const { text } = await request.json();
  if (!text || typeof text !== 'string') {
    return NextResponse.json({ error: 'No text provided.' }, { status: 400 });
  }

  const { data: prefs } = await supabase
    .from('voice_preferences')
    .select('elevenlabs_voice_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const voiceId = prefs?.elevenlabs_voice_id || DEFAULT_VOICE_ID;

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    // Character cap here is a light guardrail against an unexpectedly huge
    // response text burning through the ElevenLabs free-tier monthly quota.
    body: JSON.stringify({ text: text.slice(0, 2000), model_id: 'eleven_multilingual_v2' }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return NextResponse.json({ error: `ElevenLabs TTS failed (${response.status}): ${errText}` }, { status: 502 });
  }

  const audioBuffer = await response.arrayBuffer();
  return new NextResponse(audioBuffer, {
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}