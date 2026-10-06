// Temporary notification adapter (MVP V1) - calls the existing n8n
// "Notifications - Send Notification" workflow's webhook entry point
// (n8n/Notifications/Notifications - Send Notification.json's "Called
// Externally (Webhook)" trigger, POST /send-notification). This is the ONE
// place in the MoneyManager monitoring engine that knows n8n exists - every
// other module (rules, classification, report building, MoneyManagerSource,
// Office Records, runDailyReport.ts) has zero awareness of it. Per the
// target architecture (VPS scheduler -> KBrisks Agent -> Daily Report ->
// notification adapter, with n8n arriving later as the orchestration
// layer), this class is explicitly the swappable piece - replacing it with
// a different mechanism later requires no change anywhere else, only a new
// class implementing NotificationSender (./types.ts).
//
// Same N8N_WEBHOOK_BASE_URL / N8N_WEBHOOK_SECRET / x-automation-secret
// convention every existing Next.js server action in this repo already uses
// (see e.g. app/(dashboard)/goals/actions.ts's callN8nWebhook), and the same
// webhook this workflow's "Called Externally (Webhook)" trigger exposes -
// both entry points converge on the same Insert Notification -> Needs
// External Delivery? -> email/Telegram nodes; no delivery logic lives here.
import type { NotificationInput, NotificationSender } from './types';

const NOTIFICATION_WEBHOOK_PATH = 'send-notification';

export class N8nWebhookNotificationSender implements NotificationSender {
  async send(input: NotificationInput): Promise<void> {
    const baseUrl = process.env.N8N_WEBHOOK_BASE_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!baseUrl || !secret) {
      throw new Error('N8N_WEBHOOK_BASE_URL / N8N_WEBHOOK_SECRET are not configured - cannot send the daily report.');
    }

    const response = await fetch(`${baseUrl}/${NOTIFICATION_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-automation-secret': secret },
      body: JSON.stringify({
        user_id: input.userId,
        title: input.title,
        message: input.message,
        severity: input.severity,
        channel: 'in_app',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`n8n webhook "${NOTIFICATION_WEBHOOK_PATH}" failed (${response.status}): ${text}`);
    }
  }
}
