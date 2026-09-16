import { randomUUID } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MediaAssetRecord } from "@openround/db";
import type { AppConfig } from "./config.js";
import type { MalwareScanner } from "./malware-scanner.js";

const mimeExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type AllowedMimeType = keyof typeof mimeExtensions;

function validSignature(content: Uint8Array, mimeType: AllowedMimeType) {
  if (mimeType === "image/jpeg") {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((value, index) => content[index] === value);
  }
  return (
    content.length >= 12 &&
    Buffer.from(content.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(content.subarray(8, 12)).toString("ascii") === "WEBP"
  );
}

function encodedCopySource(bucket: string, key: string) {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export class StorageService {
  private readonly internalClient: S3Client | null;
  private readonly publicClient: S3Client | null;

  constructor(
    private readonly config: AppConfig,
    private readonly scanner: MalwareScanner | null,
  ) {
    const clientOptions = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    };
    this.internalClient = config.S3_ENDPOINT
      ? new S3Client({ ...clientOptions, endpoint: config.S3_ENDPOINT })
      : null;
    const publicEndpoint = config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT;
    this.publicClient = publicEndpoint
      ? new S3Client({ ...clientOptions, endpoint: publicEndpoint })
      : null;
  }

  get configured() {
    return this.internalClient !== null && this.publicClient !== null;
  }

  get mediaUploadsEnabled() {
    return this.config.FEATURE_MEDIA_UPLOADS && this.configured && this.scanner !== null;
  }

  async createUpload(input: {
    workspaceId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    altText: string;
  }) {
    if (!this.publicClient || !this.mediaUploadsEnabled)
      throw new Error("Media uploads require object storage and malware scanning");
    if (!(input.mimeType in mimeExtensions))
      throw new Error("Only JPEG, PNG, and WebP images are accepted");
    if (input.sizeBytes < 1 || input.sizeBytes > 10 * 1024 * 1024)
      throw new Error("Images must be 10 MB or smaller");
    if (!input.altText.trim()) throw new Error("Alternative text is required");
    const mimeType = input.mimeType as AllowedMimeType;
    const mediaId = randomUUID();
    const objectKey = `quarantine/${input.workspaceId}/${mediaId}.${mimeExtensions[mimeType]}`;
    const command = new PutObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: objectKey,
      ContentType: mimeType,
      ContentLength: input.sizeBytes,
      Metadata: {
        mediaId,
        originalName: encodeURIComponent(input.fileName.slice(0, 200)),
        scanStatus: "pending",
      },
    });
    const uploadUrl = await getSignedUrl(this.publicClient, command, { expiresIn: 10 * 60 });
    return {
      media: {
        id: mediaId,
        workspaceId: input.workspaceId,
        objectKey,
        mimeType,
        sizeBytes: input.sizeBytes,
        scanStatus: "pending" as const,
        altText: input.altText.trim(),
        createdAt: new Date(),
      } satisfies MediaAssetRecord,
      uploadUrl,
      expiresInSeconds: 600,
    };
  }

  async finalize(asset: MediaAssetRecord) {
    if (!this.internalClient || !this.scanner) throw new Error("Media scanning is not configured");
    if (asset.scanStatus !== "pending") {
      return { scanStatus: asset.scanStatus, objectKey: asset.objectKey };
    }
    const head = await this.internalClient.send(
      new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: asset.objectKey }),
    );
    const metadataMatches =
      head.ContentLength === asset.sizeBytes &&
      head.ContentType === asset.mimeType &&
      head.Metadata?.mediaid === asset.id;
    if (!metadataMatches) {
      await this.deleteObject(asset.objectKey);
      return { scanStatus: "rejected" as const, objectKey: asset.objectKey };
    }
    const object = await this.internalClient.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: asset.objectKey }),
    );
    if (!object.Body) throw new Error("Uploaded media content is unavailable");
    const content = await object.Body.transformToByteArray();
    if (content.byteLength !== asset.sizeBytes || !validSignature(content, asset.mimeType)) {
      await this.deleteObject(asset.objectKey);
      return { scanStatus: "rejected" as const, objectKey: asset.objectKey };
    }
    const scan = await this.scanner.scan(content);
    if (!scan.clean) {
      await this.deleteObject(asset.objectKey);
      return { scanStatus: "rejected" as const, objectKey: asset.objectKey };
    }

    const objectKey = `media/${asset.workspaceId}/${asset.id}.${mimeExtensions[asset.mimeType]}`;
    await this.internalClient.send(
      new CopyObjectCommand({
        Bucket: this.config.S3_BUCKET,
        CopySource: encodedCopySource(this.config.S3_BUCKET, asset.objectKey),
        Key: objectKey,
        MetadataDirective: "COPY",
      }),
    );
    await this.deleteObject(asset.objectKey);
    return { scanStatus: "clean" as const, objectKey };
  }

  async createDownloadUrl(asset: MediaAssetRecord) {
    if (!this.publicClient || asset.scanStatus !== "clean")
      throw new Error("Media is not available");
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: asset.objectKey }),
      { expiresIn: 5 * 60 },
    );
  }

  async deleteAsset(asset: MediaAssetRecord) {
    if (!this.internalClient) throw new Error("Object storage is not configured");
    await this.deleteObject(asset.objectKey);
  }

  private async deleteObject(objectKey: string) {
    if (!this.internalClient) throw new Error("Object storage is not configured");
    await this.internalClient.send(
      new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: objectKey }),
    );
  }
}
