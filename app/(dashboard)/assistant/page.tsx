import { Chat } from '@/components/assistant/chat';

export default function AssistantPage() {
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-neutral-900">AI Advisor</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Your business-aware assistant — answers from your uploaded documents, business memory, sales pipeline, and tasks.
        </p>
      </div>
      <Chat />
    </div>
  );
}