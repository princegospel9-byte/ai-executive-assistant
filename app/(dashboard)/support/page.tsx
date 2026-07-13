import { createClient } from '@/lib/supabase/server';
import { TicketForm } from '@/components/support/ticket-form';
import { TicketList } from '@/components/support/ticket-list';

export default async function SupportPage() {
  const supabase = await createClient();

  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('id, subject, description, status, priority, contact_email, draft_response, approval_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Support</h1>
        <p className="mt-1 text-sm text-neutral-500">
          The Support Agent drafts replies from your product documentation — every reply needs your approval before it sends.
        </p>
      </div>

      <TicketForm />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Tickets</h2>
        <TicketList tickets={tickets ?? []} />
      </div>
    </div>
  );
}