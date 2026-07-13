import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Text extraction happens here, in Next.js, deliberately - not in n8n. It
// keeps every n8n Code node free of binary-parsing dependencies (the
// established low-risk n8n authoring pattern: HTTP Request + Code nodes
// only). n8n's job starts once it receives plain text.
export async function extractText(buffer: Buffer, fileType: string): Promise<string> {
  switch (fileType) {
    case 'pdf': {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      await parser.destroy();
      return result.text;
    }
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case 'txt':
    case 'csv':
      return buffer.toString('utf-8');
    case 'xlsx': {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      return workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        return `Sheet: ${name}\n${XLSX.utils.sheet_to_csv(sheet)}`;
      }).join('\n\n');
    }
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

export function fileTypeFromName(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  if (['pdf', 'docx', 'txt', 'csv'].includes(ext)) return ext;
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  return null;
}