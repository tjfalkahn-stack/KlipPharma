import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const skip = new Set(["node_modules", ".git", "storage", ".npm-cache"]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

const files = walk(root);
let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(result.stderr || `Syntax check failed: ${file}\n`);
  }
}
if (failed) {
  process.stderr.write(`${failed} file(s) failed syntax check.\n`);
  process.exit(1);
}
console.log(`check:syntax passed (${files.length} files)`);
