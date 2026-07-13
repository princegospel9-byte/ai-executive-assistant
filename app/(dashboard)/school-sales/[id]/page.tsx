import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { StatusSelect } from '@/components/school-sales/status-select';
import { MessagePanel } from '@/components/school-sales/message-panel';

const INTEREST_STYLES: Record<string, string> = {
  hot: 'bg-red-100 text-red-800 hover:bg-red-100',
  warm: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  cold: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-100',
};

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  introduction: 'Introduction',
  demo_invitation: 'Demo invitation',
  follow_up: 'Follow-up',
  pricing: 'Pricing',
  trial_activation: 'Trial activation',
  support_reply: 'Support reply',
};

export default async function SchoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: school } = await supabase.from('schools').select('*').eq('id', id).single();
  if (!school) notFound();

  const { data: interactions } = await supabase
    .from('school_interactions')
    .select('id, interaction_type, notes, next_action, objections, occurred_at')
    .eq('school_id', id)
    .order('occurred_at', { ascending: false });

  const { data: messages } = await supabase
    .from('generated_messages')
    .select('id, message_type, channel, subject, content, status, created_at, sent_at')
    .eq('school_id', id)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/school-sales" className="text-xs text-neutral-500 hover:text-neutral-900">
          ← Back to pipeline
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{school.school_name}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {school.contact_person || 'No contact yet'}
            {school.location ? ` · ${school.location}` : ''}
            {school.student_population ? ` · ${school.student_population} students` : ''}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            {school.phone && <span>{school.phone}</span>}
            {school.phone && school.email ? ' · ' : ''}
            {school.email && <span>{school.email}</span>}
          </p>
          {school.current_software_system && (
            <p className="mt-1 text-xs text-neutral-500">Currently using: {school.current_software_system}</p>
          )}
          {school.next_follow_up_date && (
            <p className="mt-1 text-xs text-neutral-500">
              Next follow-up: {new Date(school.next_follow_up_date).toLocaleDateString()}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge className={INTEREST_STYLES[school.interest_level] ?? INTEREST_STYLES.cold}>
            {school.interest_level}
          </Badge>
          <StatusSelect schoolId={school.id} status={school.status} />
        </div>
      </div>

      <MessagePanel schoolId={school.id} />

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Message history</h2>
        {(messages ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">No messages generated yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-neutral-200">
            {(messages ?? []).map((m) => (
              <div key={m.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{m.channel}</Badge>
                    <span className="text-xs font-medium text-neutral-700">
                      {MESSAGE_TYPE_LABELS[m.message_type] ?? m.message_type}
                    </span>
                    <Badge variant="secondary">{m.status}</Badge>
                  </div>
                  <span className="text-xs text-neutral-400">
                    {new Date(m.created_at).toLocaleString()}
                  </span>
                </div>
                {m.subject && <p className="mt-1 text-sm font-medium text-neutral-900">{m.subject}</p>}
                <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600">{m.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-900">Interaction history</h2>
        {(interactions ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">No interactions logged yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-neutral-200">
            {(interactions ?? []).map((i) => (
              <div key={i.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="secondary">{i.interaction_type}</Badge>
                  <span className="text-xs text-neutral-400">{new Date(i.occurred_at).toLocaleString()}</span>
                </div>
                {i.notes && <p className="mt-1 text-sm text-neutral-700">{i.notes}</p>}
                {i.objections && <p className="mt-1 text-xs text-red-600">Objections: {i.objections}</p>}
                {i.next_action && <p className="mt-1 text-xs text-neutral-500">Next action: {i.next_action}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}