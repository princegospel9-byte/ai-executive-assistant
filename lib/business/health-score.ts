// A plain, inspectable formula, not an AI-generated "mystery number" - each
// component is independently visible so a low score is explainable, not a
// black box. Weights are equal (25 each) by design simplicity, not tuned
// against real outcomes yet.
export function computeHealthScore(input: {
  tasksCompleted: number;
  tasksPending: number;
  activeLeads: number;
  openRiskCount: number;
  revenueTrendPct: number | null; // null when there isn't enough history yet
}): { score: number; breakdown: { label: string; value: number }[] } {
  const totalTasks = input.tasksCompleted + input.tasksPending;
  const taskScore = totalTasks === 0 ? 50 : Math.round((input.tasksCompleted / totalTasks) * 100);

  const pipelineScore = Math.min(input.activeLeads * 10, 100);

  const riskScore = Math.max(100 - input.openRiskCount * 15, 0);

  const revenueScore =
    input.revenueTrendPct === null ? 50 : Math.max(Math.min(50 + input.revenueTrendPct, 100), 0);

  const breakdown = [
    { label: 'Task completion', value: taskScore },
    { label: 'Pipeline activity', value: pipelineScore },
    { label: 'Risk exposure', value: riskScore },
    { label: 'Revenue trend', value: Math.round(revenueScore) },
  ];

  const score = Math.round(breakdown.reduce((sum, b) => sum + b.value, 0) / breakdown.length);
  return { score, breakdown };
}