import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { campaignNetworkSchemaSql, campaignNetworkMigrationFiles } from "../lib/campaign-schema.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "server.js",
  "package.json",
  "Dockerfile",
  "docker-entrypoint.sh",
  "migrations/202609040001_campaign_network.sql",
  "migrations/202609040002_campaign_network_hardening.sql",
];

for (const relative of required) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    console.error(`validate:production missing ${relative}`);
    process.exit(1);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
if (pkg.scripts?.start !== "node server.js") {
  console.error("validate:production expected npm start to run node server.js");
  process.exit(1);
}

const sql = campaignNetworkSchemaSql();
if (!sql.includes("CREATE TABLE IF NOT EXISTS campaigns")) {
  console.error("validate:production campaign schema is missing campaigns table");
  process.exit(1);
}
if (!sql.includes("campaign_submissions_workspace_url_idx")) {
  console.error("validate:production campaign schema is missing workspace-scoped URL uniqueness");
  process.exit(1);
}

const migrations = campaignNetworkMigrationFiles();
if (migrations.length < 2) {
  console.error("validate:production expected campaign network migrations");
  process.exit(1);
}

console.log("validate:production passed (schema, entrypoint, and start script present; no deploy performed)");
