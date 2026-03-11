import { md5 } from '@/shared/lib/hash';
import { respData, respErr } from '@/shared/lib/resp';
import { getStorageService } from '@/shared/services/storage';

const VIDEO_MIMES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
];

const extFromMime = (mimeType: string, filename: string) => {
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
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
      const isVideo =
        file.type.startsWith('video/') || VIDEO_MIMES.includes(file.type);
      if (!isVideo) {
        return respErr(`File ${file.name} is not a video file`);
      }

      const arrayBuffer = await file.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);
      const digest = md5(body);
      const ext = extFromMime(file.type, file.name);
      const key = `video/${digest}.${ext}`;

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
    console.error('upload video failed', e);
    return respErr('upload video failed');
  }
}
