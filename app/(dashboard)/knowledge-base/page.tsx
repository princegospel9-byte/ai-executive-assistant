import { createClient } from '@/lib/supabase/server';
import { UploadForm } from '@/components/knowledge-base/upload-form';
import { DocumentList } from '@/components/knowledge-base/document-list';
import { MemoryPanel } from '@/components/knowledge-base/memory-panel';

export default async function KnowledgeBasePage() {
  const supabase = await createClient();

  const [{ data: documents }, { data: memory }] = await Promise.all([
    supabase
      .from('knowledge_documents')
      .select('id, filename, file_type, status, error_message, access_count, uploaded_at, storage_path')
      .order('uploaded_at', { ascending: false }),
    supabase.from('business_memory').select('id, category, key, value').order('category').order('key'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Knowledge Base</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Documents and business memory the AI Advisor draws on when you ask it a question.
        </p>
      </div>

      <UploadForm />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Documents</h2>
        <DocumentList documents={documents ?? []} />
      </div>

      <MemoryPanel memory={memory ?? []} />
    </div>
  );
}