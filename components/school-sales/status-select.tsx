'use client';

import { useTransition } from 'react';
import { updateSchoolStatus } from '@/app/(dashboard)/school-sales/actions';

const STAGES = [
  'new_lead',
  'contacted',
  'demo_scheduled',
  'demo_completed',
  'negotiating',
  'trial_started',
  'customer',
  'lost_lead',
] as const;

export function StatusSelect({ schoolId, status }: { schoolId: string; status: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={status}
      onChange={(e) => startTransition(() => updateSchoolStatus(schoolId, e.target.value))}
      disabled={isPending}
      className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs capitalize disabled:opacity-50"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {s.replace('_', ' ')}
        </option>
      ))}
    </select>
  );
}