'use client';

import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { importSchools } from '@/app/(dashboard)/school-sales/actions';

const EXPECTED_COLUMNS = [
  'school_name',
  'location',
  'student_population',
  'contact_person',
  'phone',
  'email',
  'current_software_system',
  'lead_source',
];

function parseCsv(text: string) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (EXPECTED_COLUMNS.includes(h)) row[h] = cells[i] ?? '';
    });
    return row;
  }).filter((row) => row.school_name);
}

export function ImportForm() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage('Choose a CSV file first.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const rows = parseCsv(text).map((r) => ({
        school_name: r.school_name,
        location: r.location || undefined,
        student_population: r.student_population ? Number(r.student_population) : undefined,
        contact_person: r.contact_person || undefined,
        phone: r.phone || undefined,
        email: r.email || undefined,
        current_software_system: r.current_software_system || undefined,
        lead_source: r.lead_source || undefined,
      }));
      if (rows.length === 0) {
        setMessage('No valid rows found — check the CSV has a school_name column.');
        return;
      }
      startTransition(async () => {
        try {
          const result = await importSchools(rows);
          setMessage(result.message);
          setOpen(false);
        } catch (err) {
          setMessage(err instanceof Error ? err.message : 'Something went wrong.');
        }
      });
    };
    reader.readAsText(file);
  }

  if (!open) {
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Import schools (CSV)
        </Button>
        {message && <p className="mt-2 text-xs text-neutral-500">{message}</p>}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import schools</CardTitle>
        <CardDescription>
          CSV with a header row. Recognized columns: {EXPECTED_COLUMNS.join(', ')}. Only school_name is required —
          export from Excel/Google Sheets as CSV first (binary .xlsx import isn&apos;t supported yet).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="text-sm" />
        <div className="flex gap-2">
          <Button onClick={handleImport} disabled={isPending}>
            {isPending ? 'Importing…' : 'Import'}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
        </div>
        {message && <p className="text-xs text-neutral-500">{message}</p>}
      </CardContent>
    </Card>
  );
}