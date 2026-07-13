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

export async function createTicket(ticket: {
  subject: string;
  description: string;
  contact_email?: string;
  school_id?: string;
  priority: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('support_tickets').insert({ user_id: user.id, ...ticket });
  if (error) throw new Error(error.message);
  revalidatePath('/support');
}

export async function closeTicket(ticketId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('support_tickets')
    .update({ status: 'closed', resolved_at: new Date().toISOString() })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);
  revalidatePath('/support');
}

export async function draftReply(ticketId: string) {
  const result = await callN8nWebhook('agent-support-draft', { ticket_id: ticketId });
  revalidatePath('/support');
  return result as { success: boolean; draft_reply: string; approval_id: string };
}

export async function decideSupportReply(approvalId: string, decision: 'approved' | 'rejected') {
  const result = await callN8nWebhook('agent-support-decision', { approval_id: approvalId, decision });
  revalidatePath('/support');
  return result as { success: boolean; status: string };
}