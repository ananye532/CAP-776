import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { del as blobDel, get as blobGet, put as blobPut } from '@vercel/blob';

/**
 * Object storage abstraction. Only metadata lives in Postgres (stored_files); bytes live here.
 * LocalDiskStorage is the default; an S3-compatible driver can implement the same interface.
 */
export interface ObjectStorage {
  put(bytes: Buffer, opts: { userId: string; ext?: string }): Promise<{ key: string; sha256: string; size: number }>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalDiskStorage implements ObjectStorage {
  constructor(private root: string) {}

  private resolve(key: string) {
    // Keys are generated server-side, but guard against traversal anyway.
    if (!/^[a-f0-9-]{36}\/[a-f0-9-]{36}(\.[a-z0-9]{1,8})?$/.test(key)) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }

  async put(bytes: Buffer, opts: { userId: string; ext?: string }) {
    const ext = opts.ext && /^[a-z0-9]{1,8}$/.test(opts.ext) ? `.${opts.ext}` : '';
    const key = `${opts.userId}/${randomUUID()}${ext}`;
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { mode: 0o600 });
    return { key, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }

  get(key: string) {
    return readFile(this.resolve(key));
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

/** Vercel Blob in private mode: files are only reachable through the authenticated /api/files route. */
export class VercelBlobStorage implements ObjectStorage {
  async put(bytes: Buffer, opts: { userId: string; ext?: string }) {
    const ext = opts.ext && /^[a-z0-9]{1,8}$/.test(opts.ext) ? `.${opts.ext}` : '';
    const key = `${opts.userId}/${randomUUID()}${ext}`;
    await blobPut(key, bytes, { access: 'private', addRandomSuffix: false });
    return { key, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
  }

  async get(key: string) {
    const r = await blobGet(key, { access: 'private' });
    if (!r || r.statusCode !== 200) throw new Error('File not found in storage');
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }

  async delete(key: string) {
    await blobDel(key);
  }
}

// Serverless file systems are ephemeral, so deployed instances must use Blob storage.
export const storage: ObjectStorage = config.BLOB_READ_WRITE_TOKEN ? new VercelBlobStorage() : new LocalDiskStorage(path.resolve(config.STORAGE_DIR));
