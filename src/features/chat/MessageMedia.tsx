import { useEffect, useState } from 'react';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { MsgType } from 'matrix-js-sdk';
import { ImageViewer } from 'antd-mobile';
import { decryptAttachment, type EncryptedAttachmentInfo } from 'browser-encrypt-attachment';

/** Resolves authenticated and Matrix-encrypted media into a WebView-safe object URL. */
export const useAuthenticatedMediaUrl = (
  src: string | null,
  accessToken?: string,
  encryptedFile?: EncryptedAttachmentInfo,
  mimeType?: string
): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src) { setUrl(null); return undefined; }
    let disposed = false;
    let objectUrl: string | undefined;
    void fetch(src, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined })
      .then(async (response) => {
        if (!response.ok) throw new Error('Media request failed');
        if (!encryptedFile) return response.blob();
        const plaintext = await decryptAttachment(await response.arrayBuffer(), encryptedFile);
        return new Blob([plaintext], { type: mimeType || 'application/octet-stream' });
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!disposed) setUrl(objectUrl);
      })
      .catch(() => { if (!disposed) setUrl(null); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [accessToken, encryptedFile, mimeType, src]);
  return url;
};

export function MessageBody({ event, client, accessToken }: { event: MatrixEvent; client: MatrixClient; accessToken?: string }) {
  const content = event.getContent();
  const encryptedFile = content.file && typeof content.file === 'object' && typeof (content.file as { url?: unknown }).url === 'string'
    ? content.file as EncryptedAttachmentInfo
    : undefined;
  const mxcUrl = typeof content.url === 'string' ? content.url : encryptedFile?.url;
  const mimeType = content.info && typeof content.info === 'object' && typeof (content.info as { mimetype?: unknown }).mimetype === 'string'
    ? (content.info as { mimetype: string }).mimetype
    : undefined;
  const mediaSource = mxcUrl ? client.mxcUrlToHttp(mxcUrl, 960, 960, 'scale', undefined, false, true) : null;
  const mediaUrl = useAuthenticatedMediaUrl(mediaSource, accessToken, encryptedFile, mimeType);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = content.msgtype === MsgType.Image;
  const isSticker = event.getType() === 'm.sticker';
  const isFile = content.msgtype === MsgType.File;
  const isAudio = content.msgtype === MsgType.Audio;
  const isVideo = content.msgtype === MsgType.Video;
  if (isImage || isSticker) return mediaUrl ? <>
    <button className="bubble image-bubble" type="button" onClick={() => setPreviewOpen(true)} aria-label="预览图片"><img src={mediaUrl} alt={typeof content.body === 'string' ? content.body : '图片'} /></button>
    <ImageViewer image={mediaUrl} visible={previewOpen} onClose={() => setPreviewOpen(false)} />
  </> : <div className="bubble media-loading">正在加载图片…</div>;
  if (isAudio) return mediaUrl ? <div className="bubble media-player"><audio controls preload="metadata" src={mediaUrl}>你的设备不支持音频播放。</audio><span>{typeof content.body === 'string' ? content.body : '语音消息'}</span></div> : <div className="bubble media-loading">正在加载语音…</div>;
  if (isVideo) return mediaUrl ? <div className="bubble media-player"><video controls playsInline preload="metadata" src={mediaUrl} /><span>{typeof content.body === 'string' ? content.body : '视频消息'}</span></div> : <div className="bubble media-loading">正在加载视频…</div>;
  if (isFile) return mediaUrl ? <div className="bubble"><a href={mediaUrl} download={typeof content.body === 'string' ? content.body : undefined}>附件：{typeof content.body === 'string' ? content.body : '下载文件'}</a></div> : <div className="bubble media-loading">正在加载附件…</div>;
  return <div className="bubble">{typeof content.body === 'string' ? content.body : '[暂不支持的消息]'}</div>;
}
