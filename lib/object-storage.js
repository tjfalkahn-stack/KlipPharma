import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const accountId = String(process.env.R2_ACCOUNT_ID || "").trim();
const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || "").trim();
const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || "").trim();
const bucket = String(process.env.R2_BUCKET || "").trim();

export const objectStorageConfigured = Boolean(accountId && accessKeyId && secretAccessKey && bucket);

const client = objectStorageConfigured
  ? new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
  : null;

export async function createDirectUpload(userId, file) {
  requireStorage();
  const extension = supportedExtension(file.name);
  const objectKey = `${userId}/uploads/${crypto.randomUUID()}${extension}`;
  const contentType = String(file.type || "application/octet-stream").slice(0, 200);
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: contentType,
  });
  return {
    objectKey,
    uploadUrl: await getSignedUrl(client, command, { expiresIn: 15 * 60 }),
    expiresIn: 15 * 60,
  };
}

export async function verifyObject(userId, objectKey) {
  requireStorage();
  assertOwnedKey(userId, objectKey);
  const result = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  return { size: Number(result.ContentLength || 0), type: result.ContentType || "application/octet-stream" };
}

export async function downloadObject(objectKey, destination) {
  requireStorage();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!result.Body) throw new Error("The uploaded source is empty.");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part`;
  try {
    await pipeline(result.Body, fs.createWriteStream(temporary));
    fs.renameSync(temporary, destination);
  } catch (error) {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    throw error;
  }
}

export function assertOwnedKey(userId, objectKey) {
  const value = String(objectKey || "");
  if (!value.startsWith(`${userId}/uploads/`) || value.includes("..") || value.includes("\\")) {
    throw new Error("That upload does not belong to this workspace.");
  }
  return value;
}

function supportedExtension(name) {
  const extension = path.extname(String(name || "")).toLowerCase();
  const supported = new Set([".mov", ".mp4", ".m4v", ".webm", ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac", ".mpeg", ".mpg"]);
  if (!supported.has(extension)) throw new Error("Choose MP4, MOV, M4V, WebM, MP3, M4A, WAV, AAC, OGG, FLAC, MPEG, or MPG files.");
  return extension;
}

function requireStorage() {
  if (!client) throw new Error("Cloud object storage is not configured.");
}
