# AI Voice & Multimodal Executive Assistant (Phase 8)

## ElevenLabs setup

Used for both speech-to-text (Scribe) and text-to-speech — one vendor instead of two, since ElevenLabs added STT after this phase was originally scoped around Deepgram + ElevenLabs.

1. Sign up at elevenlabs.io (free tier: 10,000 credits/month, ~10 minutes of audio).
2. Create an API key.
3. Add `ELEVENLABS_API_KEY` to `.env.local` (and Vercel env vars) — **not** an n8n Variable, since it's only ever called from the two Next.js Route Handlers below, never from n8n.

## Design decisions

1. **Voice's real-time loop bypasses n8n entirely.** n8n's queued execution model can't hold a live audio stream. The browser records an utterance (push-to-talk, not continuous listening with voice-activity-detection — simpler and more reliable), posts it to `app/api/voice/transcribe`, which proxies to ElevenLabs so the API key never reaches the browser. Once text exists, it flows through the **existing** orchestration (Phase 6's `askAdvisor`, Phase 7's `orchestrateRequest`) unchanged — voice is a new input/output modality on an existing brain, not a new assistant.
2. **No `approval_requests` table** — reuses `approvals` (Phase 3). A spoken "yes" is just a different UI for the same approve/reject action.
3. **`meeting_summaries` merged into `meeting_transcripts`** (1:1, no reason to join).
4. **`uploaded_media` is images only** — PDF/DOCX/XLSX/CSV reuse `knowledge_documents` (Phase 6) untouched.
5. **Vision extends `AI - Process Request`** with an optional `image_data`/`image_media_type` flag, the same extension pattern Phase 7 used for web search — not a fork.
6. **Meeting action items become real `tasks`** (Phase 4's table), not a parallel concept — they show up on the Tasks page and in the daily briefing like any other task.
7. **Cost note, upfront**: ElevenLabs' free tier (~10 min/month combined STT+TTS) is workable for light use; regular conversational use or long meeting recordings will exceed it and move you onto their $6/month Starter tier. `/api/voice/speak` caps text at 2000 characters per call as a light guardrail against accidentally burning the monthly quota on one long response.

## Database

Migration `0018_voice_multimodal.sql`: `voice_sessions`, `voice_transcripts`, `meeting_transcripts` (transcript + summary + action_items + decisions in one row), `uploaded_media`, `voice_preferences`, `conversation_memory`, plus private Storage buckets `voice-recordings` and `uploaded-media`. Migration `0019_voice_prompts.sql`: `meeting_summary`, `dictation_cleanup`, `image_analysis`.

## New n8n workflows

| Workflow | Trigger | Does |
|---|---|---|
| `Voice - Analyze Image` | Webhook (`/analyze-image`) | Vision call via `AI - Process Request`, writes the description back to `uploaded_media` (feeds `/search`) |
| `Voice - Dictation Cleanup` | Webhook (`/voice-dictation-cleanup`) | Grammar/formatting cleanup on dictated text, preserves meaning, flags unclear parts instead of guessing |
| `Voice - Process Meeting Recording` | Webhook (`/voice-process-meeting`) | Summarizes a meeting transcript, creates real `tasks` for action items, records decisions/next-meeting-date |

Modified: `AI - Process Request` (image_data flag).

## New pages / UI

- `/assistant` — mic button + "Voice mode" toggle (speaks replies aloud), reusing the existing Ask/Delegate chat.
- `/knowledge-base` — image upload section alongside documents; `/search` now searches image descriptions too.
- `/voice` — preferences, meeting recorder, meeting summaries, dictation panel, recent conversation log, AI activity. Pending approvals aren't duplicated here — linked to the existing `/agents` inbox instead.
- Home dashboard — "Listen" button on today's briefing (reads `daily_briefings.content_text` aloud, no new data needed).

## Post-import checklist additions

Re-link Execute Workflow nodes to `AI - Process Request` in all three new workflows. Set Error Workflow → `Core - Error Handler`. Activate all three webhooks (same `N8N_WEBHOOK_BASE_URL`). Add `ELEVENLABS_API_KEY` to `.env.local` / Vercel — this is the only new environment variable this phase needs (no new n8n Variable).

## Known limitations (honest, not silently cut)

- Speech recognition/synthesis quality depends entirely on ElevenLabs' models — not evaluated against alternatives here.
- Meeting recording requires the browser tab to stay open and focused for the whole meeting; very long recordings are untested against ElevenLabs' upload limits in practice.
- Voice command routing reuses the existing Ask/Delegate text pipeline rather than a dedicated intent-classification layer — deterministic one-word commands ("archive this email") aren't wired to direct actions yet, only conversational requests are.

## Testing

1. On `/assistant`, enable Voice mode, tap Speak, ask a question, confirm transcription, response, and spoken playback all work, and that interrupting playback by tapping Speak again stops it immediately.
2. Upload an image on `/knowledge-base`, confirm a real description appears and the image is findable from `/search`.
3. On `/voice`, dictate a short email and confirm the cleaned-up version preserves your meaning without inventing content.
4. Record a short test meeting, end it, and confirm a summary, decisions, and at least one real task appear.
5. Click "Listen" on the home dashboard's briefing and confirm it reads the actual briefing text aloud.