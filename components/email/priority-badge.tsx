import { Badge } from '@/components/ui/badge';

const PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 hover:bg-red-100',
  high: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  medium: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  low: 'bg-neutral-100 text-neutral-600 hover:bg-neutral-100',
};

export function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const style = PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium;
  return <Badge className={style}>{priority}</Badge>;
}