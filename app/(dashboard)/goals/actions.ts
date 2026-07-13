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

export async function createGoal(goal: {
  title: string;
  description?: string;
  goal_type: string;
  target_value?: number;
  target_date?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('company_goals').insert({ user_id: user.id, ...goal });
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

export async function updateGoalStatus(goalId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('company_goals').update({ status }).eq('id', goalId);
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

export async function deleteGoal(goalId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from('company_goals').delete().eq('id', goalId);
  if (error) throw new Error(error.message);
  revalidatePath('/goals');
}

export async function analyzeGoal(goalId: string) {
  const result = await callN8nWebhook('goals-analyze-progress', { goal_id: goalId });
  revalidatePath('/goals');
  return result as {
    success: boolean;
    analysis: string;
    blockers: string[];
    recommended_actions: string[];
    predicted_completion: string;
    current_value: number | null;
  };
}