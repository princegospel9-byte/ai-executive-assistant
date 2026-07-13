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

export async function createTaskFromText(text: string) {
  const result = await callN8nWebhook('task-create-nl', { text });
  revalidatePath('/tasks');
  return result as { success: boolean; kind: string; title: string };
}

export async function updateTaskStatus(taskId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId);
  if (error) throw new Error(error.message);
  revalidatePath('/tasks');
}

export async function createTaskFromEmail(emailId: string) {
  const result = await callN8nWebhook('task-create-from-email', { email_id: emailId });
  revalidatePath('/tasks');
  return result as { success: boolean; task_id: string; title: string };
}