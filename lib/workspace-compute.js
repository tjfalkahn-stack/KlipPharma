import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WORKLOADS = [
  "source_footage",
  "proxies",
  "transcripts",
  "temporary_frames",
  "local_transcription",
  "ffmpeg_processing",
  "render_cache",
  "exports",
  "model_cache",
];

export function resolveWorkspaceCompute(env = process.env, { defaultStorageRoot = undefined } = {}) {
  const configuredRoot = String(env.KLIPPHARMA_WORKSPACE_ROOT || "").trim();
  const cloudRoot = String(env.STORAGE_ROOT || defaultStorageRoot || "").trim();
  const root = configuredRoot && isUsableDirectory(configuredRoot) ? path.resolve(configuredRoot) : (cloudRoot || path.join(os.tmpdir(), "klippharma-workspace"));
  const usingExternal = Boolean(configuredRoot && isUsableDirectory(configuredRoot));
  const paths = Object.fromEntries(WORKLOADS.map((name) => [name, path.join(root, name.replaceAll("_", "-"))]));
  const compute = {
    configuredRoot: configuredRoot || null,
    activeRoot: root,
    usingExternalWorkspace: usingExternal,
    fallbackReason: usingExternal ? null : (configuredRoot ? "Configured workspace root is unavailable; using cloud/local storage fallback." : null),
    workloads: paths,
  };
  return compute;
}

export function isUsableDirectory(value) {
  try {
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved)) return false;
    const stats = fs.statSync(resolved);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export function ensureComputeDirectories(compute) {
  for (const folder of Object.values(compute.workloads || {})) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return compute;
}

export function publicComputeCapabilities(compute = {}) {
  const workloadNames = Object.keys(compute.workloads || {});
  return {
    externalWorkspaceAvailable: Boolean(compute.usingExternalWorkspace),
    fallbackActive: !compute.usingExternalWorkspace,
    workloadCapabilities: workloadNames,
  };
}
