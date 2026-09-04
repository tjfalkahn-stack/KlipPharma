import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "../migrations");

export function campaignNetworkMigrationFiles() {
  return fs.readdirSync(migrationsDir)
    .filter((name) => name.includes("campaign_network") && name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(migrationsDir, name));
}

export function campaignNetworkSchemaSql() {
  return campaignNetworkMigrationFiles()
    .map((file) => fs.readFileSync(file, "utf8").replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, ""))
    .join("\n");
}
