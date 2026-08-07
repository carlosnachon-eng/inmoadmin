import crypto from "node:crypto";

export function migrationSha256(sql) {
  return crypto.createHash("sha256").update(String(sql), "utf8").digest("hex");
}

export function assertAppliedMigrationUnchanged({ filename, appliedHash, currentSql }) {
  const currentHash = migrationSha256(currentSql);
  if (currentHash !== appliedHash) {
    throw new Error(`La migración aplicada cambió: ${filename}`);
  }
  return currentHash;
}

