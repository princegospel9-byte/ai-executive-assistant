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

export async function editDraft(draftId: string, editedText: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('draft_replies')
    .update({ edited_text: editedText })
    .eq('id', draftId);

  if (error) throw new Error(error.message);
  revalidatePath('/email');
}

export async function approveDraft(approvalId: string, emailId: string) {
  await callN8nWebhook('email-approval-decision', { approval_id: approvalId, decision: 'approved' });
  revalidatePath(`/email/${emailId}`);
  revalidatePath('/email');
}

export async function rejectDraft(approvalId: string, emailId: string) {
  await callN8nWebhook('email-approval-decision', { approval_id: approvalId, decision: 'rejected' });
  revalidatePath(`/email/${emailId}`);
  revalidatePath('/email');
}

export async function regenerateDraft(emailId: string, tone: string) {
  await callN8nWebhook('email-generate-draft', { email_id: emailId, tone });
  revalidatePath(`/email/${emailId}`);
  revalidatePath('/email');
}