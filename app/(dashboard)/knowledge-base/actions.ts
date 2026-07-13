'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { extractText, fileTypeFromName } from '@/lib/knowledge-base/extract-text';

async function callN8nWebhook(path: string, body: Record<string, unknown>) {
  const baseUrl = process.env.N8N_WEBHOOK_BASE_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!baseUrl || !secret) {
    throw new Error('N8N_WEBHOOK_BASE_URL / N8N_WEBHOOK_SECRET are not configured in .env.local.');
  }

  const response = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-automation-secret': secret,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`n8n webhook "${path}" failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function uploadDocument(formData: FormData) {
  const file = formData.get('file') as File | null;
  if (!file) throw new Error('No file provided.');

  const fileType = fileTypeFromName(file.name);
  if (!fileType) throw new Error('Unsupported file type. Use PDF, DOCX, TXT, CSV, or XLSX.');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${user.id}/${crypto.randomUUID()}/${file.name}`;

  const { error: uploadError } = await supabase.storage.from('knowledge-documents').upload(storagePath, buffer, {
    contentType: file.type || undefined,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data: doc, error: insertError } = await supabase
    .from('knowledge_documents')
    .insert({ filename: file.name, storage_path: storagePath, file_type: fileType, status: 'processing' })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);

  revalidatePath('/knowledge-base');

  try {
    const text = await extractText(buffer, fileType);
    await callN8nWebhook('kb-process-document', { document_id: doc.id, text });
  } catch (err) {
    await supabase
      .from('knowledge_documents')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : 'Extraction failed.' })
      .eq('id', doc.id);
    revalidatePath('/knowledge-base');
    throw err;
  }

  revalidatePath('/knowledge-base');
}

export async function deleteDocument(documentId: string, storagePath: string) {
  const supabase = await createClient();
  await supabase.storage.from('knowledge-documents').remove([storagePath]);
  const { error } = await supabase.from('knowledge_documents').delete().eq('id', documentId);
  if (error) throw new Error(error.message);
  revalidatePath('/knowledge-base');
}

export async function upsertMemory(category: string, key: string, value: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase
    .from('business_memory')
    .upsert({ user_id: user.id, category, key, value, updated_at: new Date().toISOString() }, { onConflict: 'user_id,category,key' });
  if (error) throw new Error(error.message);
  revalidatePath('/knowledge-base');
}

export async function deleteMemory(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('business_memory').delete().eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/knowledge-base');
}