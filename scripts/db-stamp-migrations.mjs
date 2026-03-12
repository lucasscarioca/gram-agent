#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const mode = process.argv.includes("--remote") ? "--remote" : process.argv.includes("--local") ? "--local" : null;

if (!mode) {
  console.error("usage: node scripts/db-stamp-migrations.mjs --local|--remote");
  process.exit(1);
}

const modeLabel = mode === "--remote" ? "remote" : "local";
const migrations = readdirSync(join(process.cwd(), "db", "migrations"))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();

runSql(`
  CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

for (const migration of migrations) {
  runSql(`
    INSERT INTO d1_migrations (name)
    SELECT '${migration}'
    WHERE NOT EXISTS (
      SELECT 1 FROM d1_migrations WHERE name = '${migration}'
    )
  `);
}

console.log(`db stamp (${modeLabel}): recorded ${migrations.length} migration file(s)`);

function runSql(sql) {
  const result = spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", mode, "--command", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status === 0) {
    return;
  }

  const output = `${result.stdout}\n${result.stderr}`.trim();
  console.error(output);
  process.exit(result.status ?? 1);
}
