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

type ImportRow = {
  school_name: string;
  location?: string;
  student_population?: number;
  contact_person?: string;
  phone?: string;
  email?: string;
  current_software_system?: string;
  lead_source?: string;
};

export async function importSchools(rows: ImportRow[]) {
  const result = await callN8nWebhook('crm-import-schools', { rows });
  revalidatePath('/school-sales');
  return result as { success: boolean; message: string };
}

export async function updateSchoolStatus(schoolId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('schools').update({ status }).eq('id', schoolId);
  if (error) throw new Error(error.message);
  revalidatePath('/school-sales');
  revalidatePath(`/school-sales/${schoolId}`);
}

export async function generateMessage(schoolId: string, messageType: string, channel: string) {
  const result = await callN8nWebhook('crm-generate-message', { school_id: schoolId, message_type: messageType, channel });
  revalidatePath(`/school-sales/${schoolId}`);
  return result as {
    success: boolean;
    message_id: string;
    channel: string;
    subject: string | null;
    content: string;
    approval_id: string | null;
  };
}

export async function approveMessage(approvalId: string, schoolId: string) {
  const result = await callN8nWebhook('crm-send-decision', { approval_id: approvalId, decision: 'approved' });
  revalidatePath(`/school-sales/${schoolId}`);
  return result as { success: boolean; status: string };
}

export async function rejectMessage(approvalId: string, schoolId: string) {
  const result = await callN8nWebhook('crm-send-decision', { approval_id: approvalId, decision: 'rejected' });
  revalidatePath(`/school-sales/${schoolId}`);
  return result as { success: boolean; status: string };
}

export async function markWhatsAppSent(messageId: string, schoolId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('generated_messages')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw new Error(error.message);
  revalidatePath(`/school-sales/${schoolId}`);
}

export async function generateInsights() {
  const result = await callN8nWebhook('crm-generate-insights', {});
  return result as { success: boolean; insights: string; pipeline_counts: Record<string, number>; total_active: number };
}