'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

async function callN8nWebhook(path: string, body: Record<string, unknown>) {
  const baseUrl = process.env.N8N_WEBHOOK_BASE_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!baseUrl || !secret) {
    throw new Error('N8N_WEBHOOK_BASE_URL / N8N_WEBHOOK_SECRET are not configured in .env.local.');
  }

  const response = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-automation-secret': secret },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`n8n webhook "${path}" failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function createMeeting(title: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { data, error } = await supabase
    .from('meeting_transcripts')
    .insert({ user_id: user.id, title, status: 'recording' })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function saveMeetingAudio(meetingId: string, formData: FormData) {
  const file = formData.get('file') as File | null;
  if (!file) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${user.id}/${meetingId}.webm`;
  const { error: uploadError } = await supabase.storage.from('voice-recordings').upload(storagePath, buffer, {
    contentType: 'audio/webm',
    upsert: true,
  });
  if (uploadError) throw new Error(uploadError.message);

  await supabase.from('meeting_transcripts').update({ audio_storage_path: storagePath }).eq('id', meetingId);
}

export async function processMeeting(meetingId: string, transcriptText: string) {
  const supabase = await createClient();
  await supabase.from('meeting_transcripts').update({ transcript_text: transcriptText, status: 'processing' }).eq('id', meetingId);
  revalidatePath('/voice');

  try {
    await callN8nWebhook('voice-process-meeting', { meeting_id: meetingId });
  } catch (err) {
    await supabase
      .from('meeting_transcripts')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Processing failed.' })
      .eq('id', meetingId);
    revalidatePath('/voice');
    throw err;
  }
  revalidatePath('/voice');
}

export async function dictate(rawText: string, targetType: string) {
  const result = await callN8nWebhook('voice-dictation-cleanup', { raw_text: rawText, target_type: targetType });
  return result as { success: boolean; cleaned_text: string; needs_clarification: boolean; clarification_note: string | null };
}

export async function updateVoicePreferences(prefs: {
  voice_enabled: boolean;
  response_style: string;
  autoplay_briefing: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('voice_preferences').upsert({ user_id: user.id, ...prefs, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  revalidatePath('/voice');
}