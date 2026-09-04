import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function campaignNetworkSchemaSql() {
  const sql = fs.readFileSync(
    path.join(__dirname, "../migrations/202609040001_campaign_network.sql"),
    "utf8",
  );
  return sql.replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
}
