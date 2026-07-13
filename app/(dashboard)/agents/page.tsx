import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';
import { PendingApprovals } from '@/components/agents/pending-approvals';

export default async function AgentsPage() {
  const supabase = await createClient();

  const [{ data: agents }, { data: pendingOutputs }, { data: recentOutputs }] = await Promise.all([
    supabase.from('agents').select('id, agent_key, name, role, description, capabilities, status').order('name'),
    supabase
      .from('agent_outputs')
      .select('id, output_text, approval_id, agent_tasks(agents(name))')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false }),
    supabase
      .from('agent_outputs')
      .select('id, output_text, status, created_at, agent_tasks(subtask, agents(name))')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  type NestedOutput = { id: string; output_text: string; approval_id: string | null; agent_tasks: { agents: { name: string } | null } | null };
  const pending = ((pendingOutputs ?? []) as unknown as NestedOutput[])
    .filter((o) => o.approval_id)
    .map((o) => ({ id: o.id, output_text: o.output_text, approval_id: o.approval_id as string, agent_name: o.agent_tasks?.agents?.name ?? 'Unknown agent' }));

  type RecentOutput = { id: string; output_text: string; status: string; created_at: string; agent_tasks: { subtask: string; agents: { name: string } | null } | null };
  const recent = (recentOutputs ?? []) as unknown as RecentOutput[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Agent Team</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Your AI Chief of Staff delegates to these agents from the AI Advisor&apos;s &quot;Delegate to agent team&quot; mode.
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Needs your approval</h2>
        <PendingApprovals outputs={pending} />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Roster</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(agents ?? []).map((a) => (
            <div key={a.id} className="rounded-lg border border-neutral-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-neutral-900">{a.name}</p>
                <Badge variant="secondary">{a.status}</Badge>
              </div>
              <p className="text-xs text-neutral-500">{a.role}</p>
              <p className="mt-2 text-sm text-neutral-600">{a.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(a.capabilities ?? []).map((c: string) => (
                  <Badge key={c} variant="secondary">
                    {c.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Recent activity</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-neutral-500">No agent activity yet — try delegating a request from the AI Advisor.</p>
        ) : (
          <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {recent.map((o) => (
              <div key={o.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{o.agent_tasks?.agents?.name ?? 'Unknown agent'}</Badge>
                    <Badge variant="secondary">{o.status}</Badge>
                  </div>
                  <span className="text-xs text-neutral-400">{new Date(o.created_at).toLocaleString()}</span>
                </div>
                {o.agent_tasks?.subtask && <p className="mt-1 text-xs text-neutral-500">{o.agent_tasks.subtask}</p>}
                <p className="mt-1 text-sm text-neutral-700">{o.output_text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}