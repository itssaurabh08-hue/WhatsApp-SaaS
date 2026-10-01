import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Object storage for media files. "s3" works with AWS S3 and S3-compatible
 * services (MinIO, Cloudflare R2, ...). "local" writes to disk and is meant for
 * development and tests: web and worker must share the directory.
 */
export interface StorageProvider {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements StorageProvider {
  constructor(private readonly root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("invalid storage key");
    return full;
  }

  async put(key: string, data: Uint8Array) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string) {
    return readFile(this.resolve(key));
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}

class S3Storage implements StorageProvider {
  private readonly client: S3Client;

  constructor(private readonly bucket: string) {
    this.client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT || undefined,
      // MinIO and most self-hosted services need path-style URLs.
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials:
        process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
          ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }
          : undefined,
    });
  }

  async put(key: string, data: Uint8Array, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error("empty object");
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER || "local";
  if (driver === "s3") {
    if (!process.env.S3_BUCKET) throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3");
    instance = new S3Storage(process.env.S3_BUCKET);
  } else {
    instance = new LocalStorage(path.resolve(process.env.STORAGE_LOCAL_DIR || ".data/storage"));
  }
  return instance;
}

/** Test hook. */
export function setStorageForTests(storage: StorageProvider | null) {
  instance = storage;
}

export function storageKey(workspaceId: string, mediaId: string) {
  return `workspaces/${workspaceId}/media/${mediaId}`;
}
