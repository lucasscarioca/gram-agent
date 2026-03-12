#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const mode = process.argv.includes("--remote") ? "--remote" : process.argv.includes("--local") ? "--local" : null;

if (!mode) {
  console.error("usage: node scripts/db-doctor.mjs --local|--remote");
  process.exit(1);
}

const modeLabel = mode === "--remote" ? "remote" : "local";
const repoMigrations = readdirSync(join(process.cwd(), "db", "migrations"))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();

const tables = getTableNames();
const hasAppTables = ["chats", "sessions", "messages", "runs"].every((table) => tables.has(table));

if (!hasAppTables) {
  console.error(`db doctor (${modeLabel}): database looks uninitialized`);
  console.error(`run pnpm run db:setup:${modeLabel} for a fresh database`);
  console.error("do not run migrations first on an empty database");
  process.exit(1);
}

const appliedMigrations = getAppliedMigrations(tables.has("d1_migrations"));
const issues = [];
const warnings = [];

checkLedgerDrift({
  migration: "0001_add_runs_analytics.sql",
  markerPresent: hasColumns("runs", ["cached_input_tokens", "estimated_cost_usd"]),
  appliedMigrations,
  issues,
});

checkLedgerDrift({
  migration: "0002_add_session_management.sql",
  markerPresent:
    hasColumns("sessions", ["title_source", "title_updated_at", "last_auto_title_message_count"]) &&
    tables.has("pending_chat_actions"),
  appliedMigrations,
  issues,
});

for (const applied of appliedMigrations) {
  if (!repoMigrations.includes(applied)) {
    warnings.push(`applied migration missing from repo: ${applied}`);
  }
}

const pendingRepoMigrations = repoMigrations.filter((name) => !appliedMigrations.has(name));

if (issues.length > 0) {
  console.error(`db doctor (${modeLabel}): failed`);

  for (const issue of issues) {
    console.error(`- ${issue}`);
  }

  if (repoMigrations.every((migration) => !appliedMigrations.has(migration))) {
    console.error(`if this database was initialized from db/schema.sql, run pnpm run db:stamp:${modeLabel}`);
  }

  console.error("fix the migration ledger before running db:migrate");
  process.exit(1);
}

console.log(`db doctor (${modeLabel}): ok`);

if (pendingRepoMigrations.length > 0) {
  console.log(`pending migrations: ${pendingRepoMigrations.join(", ")}`);
} else {
  console.log("pending migrations: none");
}

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

function getTableNames() {
  const rows = runSql("SELECT name FROM sqlite_master WHERE type = 'table'");
  return new Set(rows.map((row) => String(row.name)));
}

function getAppliedMigrations(hasMigrationTable) {
  if (!hasMigrationTable) {
    return new Set();
  }

  const rows = runSql("SELECT name FROM d1_migrations ORDER BY name");
  return new Set(rows.map((row) => String(row.name)));
}

function hasColumns(tableName, columnNames) {
  const rows = runSql(`PRAGMA table_info(${tableName})`);
  const presentColumns = new Set(rows.map((row) => String(row.name)));
  return columnNames.every((columnName) => presentColumns.has(columnName));
}

function checkLedgerDrift(input) {
  if (input.markerPresent && !input.appliedMigrations.has(input.migration)) {
    input.issues.push(`schema looks like ${input.migration} is already applied, but d1_migrations is missing it`);
  }
}

function runSql(sql) {
  const result = spawnSync("pnpm", ["exec", "wrangler", "d1", "execute", "DB", mode, "--command", sql], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  const output = `${result.stdout}\n${result.stderr}`.trim();

  if (result.status !== 0) {
    console.error(output);
    process.exit(result.status ?? 1);
  }

  const jsonStart = result.stdout.indexOf("[");

  if (jsonStart === -1) {
    console.error(output);
    process.exit(1);
  }

  const payload = JSON.parse(result.stdout.slice(jsonStart));
  return payload[0]?.results ?? [];
}
