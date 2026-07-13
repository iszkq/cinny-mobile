declare module 'browser-encrypt-attachment' {
  export interface EncryptedAttachmentInfo {
    url: string;
    key: { alg: string; key_ops: string[]; kty: string; k: string; ext: boolean };
    iv: string;
    hashes: Record<string, string>;
    v: string;
  }

  export function encryptAttachment(dataBuffer: ArrayBuffer): Promise<{ data: ArrayBuffer; info: EncryptedAttachmentInfo }>;
  export function decryptAttachment(dataBuffer: ArrayBuffer, info: EncryptedAttachmentInfo): Promise<ArrayBuffer>;
}
