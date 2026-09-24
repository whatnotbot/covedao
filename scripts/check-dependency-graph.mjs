#!/usr/bin/env node
/**
 * Dependency-graph check: prevents the cove-simplicity ↔ cove-guardian cycle
 * from returning and enforces the production direction.
 *
 *   cove-simplicity MUST NOT depend on cove-guardian (directly or transitively)
 *   cove-guardian MAY depend on cove-simplicity
 *
 * Also detects ANY workspace dependency cycle (DFS back-edge).
 *
 * Exits 1 with a precise message on violation; 0 otherwise.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCOPES = ["packages", "apps"];

const packages = new Map(); // name -> { name, dir, deps:Set<name> }

for (const scope of SCOPES) {
  const scopeDir = join(ROOT, scope);
  if (!existsSync(scopeDir)) continue;
  for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(scopeDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const deps = new Set();
    for (const [name, spec] of Object.entries({
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
    })) {
      if (typeof spec === "string" && spec.startsWith("workspace:")) deps.add(name);
    }
    packages.set(manifest.name, { name: manifest.name, dir: join(scope, entry.name), deps });
  }
}

function fail(msg) {
  console.error(`DEPENDENCY-GRAPH VIOLATION: ${msg}`);
  process.exit(1);
}

// 1. General cycle detection (DFS).
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const color = new Map();
for (const name of packages.keys()) color.set(name, WHITE);
const stack = [];

function visit(name) {
  color.set(name, GRAY);
  stack.push(name);
  const pkg = packages.get(name);
  for (const dep of pkg.deps) {
    if (!packages.has(dep)) continue; // external
    const c = color.get(dep);
    if (c === GRAY) {
      const cycle = [...stack.slice(stack.indexOf(dep)), dep].join(" → ");
      fail(`cycle detected: ${cycle}`);
    } else if (c === WHITE) {
      visit(dep);
    }
  }
  stack.pop();
  color.set(name, BLACK);
}
for (const name of packages.keys()) if (color.get(name) === WHITE) visit(name);

// 2. Directional security property: cove-simplicity must NOT reach cove-guardian.
function transitiveDeps(name, seen = new Set()) {
  if (seen.has(name)) return seen;
  seen.add(name);
  const pkg = packages.get(name);
  if (!pkg) return seen;
  for (const dep of pkg.deps) transitiveDeps(dep, seen);
  return seen;
}

const SIMPLICITY = "@crclaunch/cove-simplicity";
const GUARDIAN = "@crclaunch/cove-guardian";

if (!packages.has(SIMPLICITY)) fail(`missing ${SIMPLICITY}`);
if (!packages.has(GUARDIAN)) fail(`missing ${GUARDIAN}`);

if (transitiveDeps(SIMPLICITY).has(GUARDIAN)) {
  fail(`${SIMPLICITY} depends on ${GUARDIAN} (directly or transitively) — forbidden`);
}

if (!transitiveDeps(GUARDIAN).has(SIMPLICITY)) {
  fail(`${GUARDIAN} does not depend on ${SIMPLICITY} — expected production direction`);
}

console.log(
  `dependency graph OK: ${packages.size} workspace packages, no cycles, ` +
    `${SIMPLICITY} ⇏ ${GUARDIAN}, ${GUARDIAN} → ${SIMPLICITY}`,
);
