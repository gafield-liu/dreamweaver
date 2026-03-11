import { md5 } from '@/shared/lib/hash';
import { respData, respErr } from '@/shared/lib/resp';
import { getStorageService } from '@/shared/services/storage';

const AUDIO_MIMES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/x-wav',
  'audio/flac',
];

const extFromMime = (mimeType: string, filename: string) => {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
  };
  return map[mimeType] || filename.split('.').pop() || 'bin';
};

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return respErr('No files provided');
    }

    const storageService = await getStorageService();
    const uploadResults: { url: string; key: string; filename: string }[] = [];

    for (const file of files) {
      const isAudio =
        file.type.startsWith('audio/') || AUDIO_MIMES.includes(file.type);
      if (!isAudio) {
        return respErr(`File ${file.name} is not an audio file`);
      }

      const arrayBuffer = await file.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);
      const digest = md5(body);
      const ext = extFromMime(file.type, file.name);
      const key = `audio/${digest}.${ext}`;

      const exists = await storageService.exists({ key });
      if (exists) {
        const publicUrl = storageService.getPublicUrl({ key });
        if (publicUrl) {
          uploadResults.push({
            url: publicUrl,
            key,
            filename: file.name,
          });
          continue;
        }
      }

      const result = await storageService.uploadFile({
        body,
        key,
        contentType: file.type,
        disposition: 'inline',
      });

      if (!result.success) {
        return respErr(result.error || 'Upload failed');
      }

      uploadResults.push({
        url: result.url!,
        key: result.key!,
        filename: file.name,
      });
    }

    return respData({
      urls: uploadResults.map((r) => r.url),
      results: uploadResults,
    });
  } catch (e) {
    console.error('upload audio failed', e);
    return respErr('upload audio failed');
  }
}
