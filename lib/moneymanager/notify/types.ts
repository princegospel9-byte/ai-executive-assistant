// Notification delivery interface (MVP V1 architecture boundary) - the core
// Daily Business Operations Report orchestration (../runDailyReport.ts)
// depends only on this interface, never on a concrete delivery mechanism.
// Today's only implementation (n8nWebhookSender.ts) calls the existing n8n
// "Notifications - Send Notification" workflow, documented there as a
// temporary adapter per the target architecture:
//   VPS scheduler -> KBrisks Agent -> Daily Report -> [this interface]
// (n8n arrives later as the orchestration layer in front of both ends).
// Swapping delivery mechanisms later (a different n8n workflow, a direct
// Gmail/Telegram/SMS call, etc.) means writing a new class implementing
// this interface - zero changes to runDailyReport.ts, dailyReport.ts, or
// formatReportMessage.ts.
export type NotificationSeverity = 'info' | 'warning' | 'critical';

export type NotificationInput = {
  userId: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
};

export interface NotificationSender {
  send(input: NotificationInput): Promise<void>;
}
