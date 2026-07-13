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

export async function uploadMedia(formData: FormData) {
  const file = formData.get('file') as File | null;
  if (!file) throw new Error('No file provided.');
  if (!file.type.startsWith('image/')) throw new Error('Only image files are supported here.');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${user.id}/${crypto.randomUUID()}/${file.name}`;

  const { error: uploadError } = await supabase.storage.from('uploaded-media').upload(storagePath, buffer, {
    contentType: file.type,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data: media, error: insertError } = await supabase
    .from('uploaded_media')
    .insert({ filename: file.name, storage_path: storagePath, media_type: 'image', status: 'processing' })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);

  revalidatePath('/knowledge-base');

  try {
    const base64 = buffer.toString('base64');
    await callN8nWebhook('analyze-image', { media_id: media.id, image_data: base64, image_media_type: file.type });
  } catch (err) {
    await supabase
      .from('uploaded_media')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Analysis failed.' })
      .eq('id', media.id);
    revalidatePath('/knowledge-base');
    throw err;
  }

  revalidatePath('/knowledge-base');
}

export async function deleteMedia(id: string, storagePath: string) {
  const supabase = await createClient();
  await supabase.storage.from('uploaded-media').remove([storagePath]);
  const { error } = await supabase.from('uploaded_media').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/knowledge-base');
}