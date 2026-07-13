'use server';

import { createClient } from '@/lib/supabase/server';

export async function startVoiceSession(mode: 'conversation' | 'dictation' | 'meeting' = 'conversation') {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { data, error } = await supabase.from('voice_sessions').insert({ user_id: user.id, mode }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function logVoiceTranscript(sessionId: string, role: 'user' | 'assistant', content: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('voice_transcripts').insert({ user_id: user.id, session_id: sessionId, role, content });
  if (error) throw new Error(error.message);
}

export async function endVoiceSession(sessionId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('voice_sessions').update({ ended_at: new Date().toISOString() }).eq('id', sessionId);
  if (error) throw new Error(error.message);
}

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

export async function askAdvisor(question: string) {
  const result = await callN8nWebhook('kb-ask-advisor', { question });
  return result as { success: boolean; answer: string; sources: string[] };
}

export type AgentRun = {
  agent_key: string;
  agent_name: string;
  output_text: string;
  requires_approval: boolean;
  approval_id: string | null;
};

export async function orchestrateRequest(request: string) {
  const result = await callN8nWebhook('agent-orchestrate', { request });
  return result as { success: boolean; combined_result: string; agent_runs: AgentRun[] };
}

export async function decideAgentOutput(approvalId: string, decision: 'approved' | 'rejected') {
  const result = await callN8nWebhook('agent-decision', { approval_id: approvalId, decision });
  return result as { success: boolean; status: string };
}