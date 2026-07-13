'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { updateVoicePreferences } from '@/app/(dashboard)/voice/actions';

type Prefs = { voice_enabled: boolean; response_style: string; autoplay_briefing: boolean };

export function PreferencesForm({ preferences }: { preferences: Prefs }) {
  const [prefs, setPrefs] = useState(preferences);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(false);
    startTransition(async () => {
      await updateVoicePreferences(prefs);
      setSaved(true);
    });
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-900">Voice preferences</h2>
      <div className="mt-3 space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={prefs.voice_enabled} onChange={(e) => setPrefs({ ...prefs, voice_enabled: e.target.checked })} />
          Voice enabled
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={prefs.autoplay_briefing} onChange={(e) => setPrefs({ ...prefs, autoplay_briefing: e.target.checked })} />
          Autoplay morning briefing on dashboard load
        </label>
        <div className="flex items-center gap-2">
          <span>Response style:</span>
          <select
            value={prefs.response_style}
            onChange={(e) => setPrefs({ ...prefs, response_style: e.target.value })}
            className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-sm"
          >
            <option value="concise">Concise</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>
      </div>
      <Button onClick={handleSave} disabled={isPending} className="mt-3">
        {isPending ? 'Saving…' : 'Save'}
      </Button>
      {saved && <span className="ml-2 text-xs text-green-700">Saved.</span>}
    </div>
  );
}