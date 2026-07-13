'use client';

import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { deleteMedia } from '@/app/(dashboard)/knowledge-base/media-actions';

type Media = {
  id: string;
  filename: string;
  status: string;
  description: string | null;
  error_message: string | null;
  storage_path: string;
  created_at: string;
};

const STATUS_STYLES: Record<string, string> = {
  ready: 'bg-green-100 text-green-800 hover:bg-green-100',
  processing: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  failed: 'bg-red-100 text-red-800 hover:bg-red-100',
};

export function MediaList({ media }: { media: Media[] }) {
  const [isPending, startTransition] = useTransition();

  if (media.length === 0) {
    return <p className="text-sm text-neutral-500">No images uploaded yet.</p>;
  }

  return (
    <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {media.map((m) => (
        <div key={m.id} className="px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-neutral-900">{m.filename}</span>
              <Badge className={STATUS_STYLES[m.status] ?? STATUS_STYLES.processing}>{m.status}</Badge>
            </div>
            <Button variant="outline" onClick={() => startTransition(() => deleteMedia(m.id, m.storage_path))} disabled={isPending}>
              Delete
            </Button>
          </div>
          {m.description && <p className="mt-1 text-sm text-neutral-600">{m.description}</p>}
          {m.error_message && <p className="mt-1 text-xs text-red-600">{m.error_message}</p>}
          <p className="mt-1 text-xs text-neutral-400">{new Date(m.created_at).toLocaleDateString()}</p>
        </div>
      ))}
    </div>
  );
}