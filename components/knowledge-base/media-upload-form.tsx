'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { uploadMedia } from '@/app/(dashboard)/knowledge-base/media-actions';

export function MediaUploadForm() {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage('Choose an image first.');
      return;
    }
    setMessage(null);
    const formData = new FormData();
    formData.set('file', file);
    startTransition(async () => {
      try {
        await uploadMedia(formData);
        setMessage(`${file.name} uploaded — analyzing.`);
        if (fileRef.current) fileRef.current.value = '';
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Upload failed.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload an image</CardTitle>
        <CardDescription>Screenshots, whiteboard photos, charts, document photos. Claude describes what it sees so it becomes searchable.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input ref={fileRef} type="file" accept="image/*" className="text-sm" />
        <Button onClick={handleUpload} disabled={isPending}>
          {isPending ? 'Uploading…' : 'Upload'}
        </Button>
        {message && <p className="text-xs text-neutral-500">{message}</p>}
      </CardContent>
    </Card>
  );
}