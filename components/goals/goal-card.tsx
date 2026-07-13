'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { updateGoalStatus, deleteGoal, analyzeGoal } from '@/app/(dashboard)/goals/actions';

type Goal = {
  id: string;
  title: string;
  description: string | null;
  goal_type: string;
  target_value: number | null;
  target_date: string | null;
  status: string;
  latestProgress: { current_value: number | null; note: string | null; recorded_at: string } | null;
};

export function GoalCard({ goal }: { goal: Goal }) {
  const [isPending, startTransition] = useTransition();
  const [analysis, setAnalysis] = useState<{
    analysis: string;
    blockers: string[];
    recommended_actions: string[];
    predicted_completion: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleAnalyze() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await analyzeGoal(goal.id);
        setAnalysis(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-neutral-900">{goal.title}</span>
          <Badge variant="secondary">{goal.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleAnalyze} disabled={isPending}>
            {isPending ? 'Analyzing…' : 'Analyze progress'}
          </Button>
          {goal.status === 'active' && (
            <Button variant="outline" onClick={() => startTransition(() => updateGoalStatus(goal.id, 'achieved'))} disabled={isPending}>
              Mark achieved
            </Button>
          )}
          <Button variant="outline" onClick={() => startTransition(() => deleteGoal(goal.id))} disabled={isPending}>
            Delete
          </Button>
        </div>
      </div>
      {goal.description && <p className="mt-1 text-sm text-neutral-600">{goal.description}</p>}
      <p className="mt-1 text-xs text-neutral-500">
        {goal.target_value !== null && `Target: ${goal.target_value}`}
        {goal.target_date && ` by ${new Date(goal.target_date).toLocaleDateString()}`}
      </p>
      {goal.latestProgress && (
        <p className="mt-1 text-xs text-neutral-500">
          Latest: {goal.latestProgress.current_value ?? '—'} ({new Date(goal.latestProgress.recorded_at).toLocaleDateString()})
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {analysis && (
        <div className="mt-3 rounded-md bg-neutral-50 p-3 text-sm">
          <p className="text-neutral-700">{analysis.analysis}</p>
          {analysis.blockers.length > 0 && (
            <p className="mt-1 text-xs text-red-600">Blockers: {analysis.blockers.join('; ')}</p>
          )}
          {analysis.recommended_actions.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-neutral-600">
              {analysis.recommended_actions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-neutral-500">Predicted completion: {analysis.predicted_completion}</p>
        </div>
      )}
    </div>
  );
}