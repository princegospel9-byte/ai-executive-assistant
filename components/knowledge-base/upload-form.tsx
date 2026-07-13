'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { uploadDocument } from '@/app/(dashboard)/knowledge-base/actions';

const ACCEPTED = '.pdf,.docx,.txt,.csv,.xlsx,.xls';

export function UploadForm() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage('Choose a file first.');
      return;
    }
    setMessage(null);
    const formData = new FormData();
    formData.set('file', file);
    startTransition(async () => {
      try {
        await uploadDocument(formData);
        setMessage(`${file.name} uploaded — processing in the background.`);
        if (fileRef.current) fileRef.current.value = '';
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Upload failed.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a document</CardTitle>
        <CardDescription>PDF, DOCX, TXT, CSV, or XLSX. It&apos;s chunked and embedded automatically so the AI Advisor can answer questions from it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input ref={fileRef} type="file" accept={ACCEPTED} className="text-sm" />
        <Button onClick={handleUpload} disabled={isPending}>
          {isPending ? 'Uploading…' : 'Upload'}
        </Button>
        {message && <p className="text-xs text-neutral-500">{message}</p>}
      </CardContent>
    </Card>
  );
}