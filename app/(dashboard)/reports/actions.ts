'use server';

import { revalidatePath } from 'next/cache';

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

export async function generateForecast() {
  const result = await callN8nWebhook('forecast-revenue', {});
  revalidatePath('/reports');
  return result as { success: boolean; predicted_value: string; confidence: string; reasoning: string };
}

export async function generateExecutiveReport(reportType: 'quarterly' | 'annual') {
  const result = await callN8nWebhook('generate-executive-report', { report_type: reportType });
  revalidatePath('/reports');
  return result as { success: boolean; report_id: string; content_text: string };
}