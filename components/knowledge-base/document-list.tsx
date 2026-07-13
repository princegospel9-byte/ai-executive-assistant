'use client';

import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { deleteDocument } from '@/app/(dashboard)/knowledge-base/actions';

type Document = {
  id: string;
  filename: string;
  file_type: string;
  status: string;
  error_message: string | null;
  access_count: number;
  uploaded_at: string;
  storage_path: string;
};

const STATUS_STYLES: Record<string, string> = {
  ready: 'bg-green-100 text-green-800 hover:bg-green-100',
  processing: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  failed: 'bg-red-100 text-red-800 hover:bg-red-100',
};

const STALE_AFTER_MS = 10 * 60 * 1000;

export function DocumentList({ documents }: { documents: Document[] }) {
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, storagePath: string) {
    startTransition(async () => {
      await deleteDocument(id, storagePath);
    });
  }

  if (documents.length === 0) {
    return <p className="text-sm text-neutral-500">No documents uploaded yet.</p>;
  }

  return (
    <div className="divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white">
      {documents.map((doc) => {
        const isStale = doc.status === 'processing' && Date.now() - new Date(doc.uploaded_at).getTime() > STALE_AFTER_MS;
        return (
          <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-neutral-900">{doc.filename}</p>
              <p className="text-xs text-neutral-500">
                {doc.file_type.toUpperCase()} · uploaded {new Date(doc.uploaded_at).toLocaleDateString()}
                {doc.access_count > 0 ? ` · referenced ${doc.access_count} time${doc.access_count === 1 ? '' : 's'}` : ''}
              </p>
              {doc.status === 'failed' && doc.error_message && (
                <p className="mt-1 text-xs text-red-600">{doc.error_message}</p>
              )}
              {isStale && (
                <p className="mt-1 text-xs text-amber-600">
                  Still processing after a while — check the n8n instance is running, or re-upload.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge className={STATUS_STYLES[doc.status] ?? STATUS_STYLES.processing}>{doc.status}</Badge>
              <Button variant="outline" onClick={() => handleDelete(doc.id, doc.storage_path)} disabled={isPending}>
                Delete
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}