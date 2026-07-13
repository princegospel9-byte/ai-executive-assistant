import { createClient } from '@/lib/supabase/server';
import { UploadForm } from '@/components/knowledge-base/upload-form';
import { DocumentList } from '@/components/knowledge-base/document-list';
import { MemoryPanel } from '@/components/knowledge-base/memory-panel';
import { MediaUploadForm } from '@/components/knowledge-base/media-upload-form';
import { MediaList } from '@/components/knowledge-base/media-list';

export default async function KnowledgeBasePage() {
  const supabase = await createClient();

  const [{ data: documents }, { data: memory }, { data: media }] = await Promise.all([
    supabase
      .from('knowledge_documents')
      .select('id, filename, file_type, status, error_message, access_count, uploaded_at, storage_path')
      .order('uploaded_at', { ascending: false }),
    supabase.from('business_memory').select('id, category, key, value').order('category').order('key'),
    supabase
      .from('uploaded_media')
      .select('id, filename, status, description, error_message, storage_path, created_at')
      .order('created_at', { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Knowledge Base</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Documents, images, and business memory the AI Advisor draws on when you ask it a question.
        </p>
      </div>

      <UploadForm />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Documents</h2>
        <DocumentList documents={documents ?? []} />
      </div>

      <MediaUploadForm />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-neutral-900">Images</h2>
        <MediaList media={media ?? []} />
      </div>

      <MemoryPanel memory={memory ?? []} />
    </div>
  );
}