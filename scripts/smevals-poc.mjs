#!/usr/bin/env node
/**
 * smevals validation-harness PoC orchestrator (agentbranch #301).
 *
 * Drives the removable, offline-safe smevals eval under eval/validation-harness
 * and enforces the spike's contract with executable checks. All smevals
 * invocations are pinned to `uvx --from smevals==0.2.0 smevals` — nothing adds
 * smevals or Python to the production application manifest.
 *
 * Subcommands (npm run poc:*):
 *   validate   static + executable contract checks (no model spend, offline)
 *   smoke      1 successful sample per (config, task) pair + crash retention
 *   full       top every pair up to 3 successful samples (idempotent)
 *   resume     top up any pair below 3 from the on-disk runs — never duplicates
 *   regrade    re-apply the default grader without executing the Runner
 *   report     smevals markdown report + infrastructure-failure appendix
 *   build      static HTML report site into .poc/reports/site
 *
 * smevals vocabulary (Task / Config / Run / Grade) stays inside this PoC. The
 * production terms it maps to are: agent configuration and validation harness
 * (CONTEXT.md → Distinctions), and the provider-neutral trace envelope
 * (TranscriptStep in src/modules/test-run).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EVAL_DIR = join(ROOT, "eval", "validation-harness");
// Runs dirs are env-overridable so the contract test can redirect them to a
// temporary directory instead of polluting the repo (build stays on the eval's
// default runs dir, matching smevals' `build` which reads eval/runs).
const RUNS_DIR = process.env.SMEVALS_POC_RUNS_DIR
  ? resolve(process.env.SMEVALS_POC_RUNS_DIR)
  : join(EVAL_DIR, "runs");
const INFRA_RUNS_DIR = process.env.SMEVALS_POC_INFRA_RUNS_DIR
  ? resolve(process.env.SMEVALS_POC_INFRA_RUNS_DIR)
  : join(ROOT, ".poc", "runs-infra");
const REPORTS_DIR = join(ROOT, ".poc", "reports");
const SITE_DIR = join(REPORTS_DIR, "site");
const REPORT_MD = join(REPORTS_DIR, "validation-harness-report.md");

const SMEVALS_PIN = "smevals==0.2.0";
const FULL_TARGET = 3;
const MAX_ROUNDS = 5;

/** Required scenario coverage — one task YAML must declare each. */
const REQUIRED_SCENARIOS = [
  "skill-activation",
  "skill-non-activation",
  "tool-selection-exact-arguments",
  "delegation-routing",
  "forbidden-behaviour",
  "partial-tool-failure-recovery",
];
const INFRA_SCENARIO = "harness-crash";

/** Artifact contract every successful run must carry (Requirement 6). */
const REQUIRED_ARTIFACTS = [
  "output.txt",            // stdout captured by smevals
  "trace.json",            // provider-neutral trace (TranscriptStep-shaped)
  "agent-configuration.json", // fully resolved agent configuration, no secrets
  "harness-version.json",  // harness version identity
  "timing.json",           // started_at / completed_at / duration_ms
  "usage.json",            // simulated token/cost fields
  "completion.json",       // completion status + exit code
  "artifacts.json",        // tool/delegation/recovery evidence
];

// --- small helpers ----------------------------------------------------------

function run(command, args, opts = {}) {
  const res = spawnSync(command, args, { encoding: "utf8", ...opts });
  if (res.error) throw res.error;
  return { status: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function uvx(args, opts = {}) {
  return run("uvx", ["--from", SMEVALS_PIN, "smevals", ...args], opts);
}

/**
 * Where smevals actually writes runs. With the default eval runs dir there is
 * no namespace; an external --runs-dir is namespaced by the slugified eval
 * name (resolve_runs_root in smevals 0.2.0). Build always reads the eval's own
 * runs dir, so the default mode keeps runs there.
 */
function effectiveRunsRoot() {
  if (process.env.SMEVALS_POC_RUNS_DIR) {
    const evalDoc = readYaml(join(EVAL_DIR, "eval.yaml"));
    return join(RUNS_DIR, slugify(evalDoc.name || "validation-harness"));
  }
  return RUNS_DIR;
}

function slugify(text) {
  return text.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** --runs-dir argument when the test redirects runs out of the repo. */
function runsDirArgs() {
  return process.env.SMEVALS_POC_RUNS_DIR ? ["--runs-dir", relative(ROOT, RUNS_DIR)] : [];
}

function readYaml(file) {
  return parseYaml(readFileSync(file, "utf8"));
}

function listYaml(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort();
}

function isExecutable(file) {
  if (!existsSync(file)) return false;
  const st = statSync(file);
  return st.isFile() && (st.mode & 0o111) !== 0;
}

/** Count successful (exit_code == 0) runs for one (config, task) pair. */
function countSuccessfulRuns(taskName, configName) {
  const pairDir = join(effectiveRunsRoot(), taskName, configName);
  if (!existsSync(pairDir)) return 0;
  let count = 0;
  for (const modelDir of readdirSync(pairDir)) {
    for (const tsDir of readdirSync(join(pairDir, modelDir))) {
      const runYaml = join(pairDir, modelDir, tsDir, "run.yaml");
      if (existsSync(runYaml) && readYaml(runYaml).exit_code === 0) count += 1;
    }
  }
  return count;
}

/** Total run directories (any exit code) for one pair. */
function countAllRuns(taskName, configName) {
  const pairDir = join(effectiveRunsRoot(), taskName, configName);
  if (!existsSync(pairDir)) return 0;
  return readdirSync(pairDir).reduce(
    (n, modelDir) =>
      n + readdirSync(join(pairDir, modelDir)).filter((f) => existsSync(join(pairDir, modelDir, f, "run.yaml"))).length,
    0,
  );
}

function snapshotRunArtifacts() {
  const snap = new Map();
  const root = effectiveRunsRoot();
  if (!existsSync(root)) return snap;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "grades") continue; // grading output, not run evidence
        walk(full);
      } else {
        snap.set(relative(root, full), statSync(full).mtimeMs);
      }
    }
  };
  walk(root);
  return snap;
}

/** Required artifact presence + JSON schema + secret scan for one run dir. */
function checkRunEvidence(runDir) {
  const problems = [];
  const missing = REQUIRED_ARTIFACTS.filter((f) => !existsSync(join(runDir, f)));
  if (missing.length > 0) problems.push(`missing artifacts: ${missing.join(", ")}`);

  for (const file of REQUIRED_ARTIFACTS.filter((f) => f.endsWith(".json"))) {
    const full = join(runDir, file);
    if (!existsSync(full)) continue;
    let doc;
    try {
      doc = JSON.parse(readFileSync(full, "utf8"));
    } catch (error) {
      problems.push(`${file} is not valid JSON: ${error.message}`);
      continue;
    }
    if (file === "agent-configuration.json") {
      const secretKeys = findSecretKeys(doc);
      if (secretKeys.length > 0) problems.push(`agent-configuration.json exposes secret-shaped keys: ${secretKeys.join(", ")}`);
      const dumped = JSON.stringify(doc);
      if (dumped.includes("SMEVALS_") || dumped.includes("process.env")) {
        problems.push("agent-configuration.json contains environment-shaped content");
      }
      if (doc.schema_version !== "agentbranch.resolved-agent-configuration.v1") problems.push("agent-configuration.json has the wrong schema_version");
      if (!doc.id) problems.push("agent-configuration.json missing id");
      if (!doc.runtime_adapter?.id || !doc.runtime_adapter?.version) problems.push("agent-configuration.json missing runtime_adapter identity");
      if (!doc.model?.provider || !doc.model?.id) problems.push("agent-configuration.json missing resolved model");
      for (const field of ["instructions", "skills", "subagents", "tools", "policies", "secret_requirements"]) {
        if (!Array.isArray(doc[field])) problems.push(`agent-configuration.json missing ${field} array`);
      }
    }
    if (file === "trace.json" && (doc.schema_version !== "agentbranch.provider-neutral-trace.v1" || !Array.isArray(doc.steps))) problems.push("trace.json has the wrong schema or steps");
    if (file === "harness-version.json" && (!doc.harness_version || !doc.runner_contract_version)) problems.push("harness-version.json missing harness_version/runner_contract_version");
    if (file === "timing.json" && (!doc.started_at || !doc.completed_at || typeof doc.duration_ms !== "number")) problems.push("timing.json missing started_at/completed_at/duration_ms");
    if (file === "usage.json" && (typeof doc.input_tokens !== "number" || typeof doc.output_tokens !== "number" || typeof doc.total_tokens !== "number" || typeof doc.cost?.amount_micros !== "number")) problems.push("usage.json missing token/cost fields");
    if (file === "completion.json" && (!doc.status || typeof doc.exit_code !== "number")) problems.push("completion.json missing status/exit_code");
    if (file === "artifacts.json" && (!Array.isArray(doc.tool_calls) || !Array.isArray(doc.delegations) || !Array.isArray(doc.recoveries))) problems.push("artifacts.json missing tool/delegation/recovery arrays");
  }
  if (existsSync(join(runDir, "output.txt")) && readFileSync(join(runDir, "output.txt"), "utf8").trim() === "") {
    problems.push("output.txt is empty");
  }
  return problems;
}

/** Secret-shaped keys anywhere in a parsed artifact (values redacted by the Runner). */
function findSecretKeys(node, path = []) {
  const found = [];
  if (Array.isArray(node)) {
    if (node.length === 0) return found; // empty requirement list is not a leak
    node.forEach((v, i) => found.push(...findSecretKeys(v, [...path, String(i)])));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      const next = [...path, k];
      // A secret-shaped key is a leak only when it carries a real value:
      // empty strings, nulls, and empty requirement lists are fine.
      if (k !== "secret_requirements" && /(?:^|[_-])(?:api[_-]?key|secret|password|credential|private[_-]?key|(?:access|refresh|auth)[_-]?token|token)(?:$|[_-])/i.test(k)) {
        const empty =
          v === "" || v === null || v === undefined ||
          (Array.isArray(v) && v.length === 0) ||
          (typeof v === "object" && v !== null && Object.keys(v).length === 0);
        if (!empty) found.push(next.join("."));
      }
      found.push(...findSecretKeys(v, next));
    }
  }
  return found;
}

// --- static contract (no smevals execution) ---------------------------------

function loadTasks() {
  return listYaml(join(EVAL_DIR, "tasks")).map((f) => ({
    file: f,
    name: basename(f, ".yaml"),
    doc: readYaml(join(EVAL_DIR, "tasks", f)),
  }));
}

function loadConfigs() {
  return listYaml(join(EVAL_DIR, "configs")).map((f) => ({
    file: f,
    name: basename(f, ".yaml"),
    doc: readYaml(join(EVAL_DIR, "configs", f)),
  }));
}

/** Static checks: matrix definition, two configs, scenario coverage, executables, containment. */
export function staticContract() {
  const findings = [];

  if (!existsSync(join(EVAL_DIR, "eval.yaml"))) {
    findings.push("eval/validation-harness/eval.yaml is missing");
    return { ok: false, findings, matrix: { tasks: [], configs: [] }, scenarios: {} };
  }
  const evalDoc = readYaml(join(EVAL_DIR, "eval.yaml"));
  if (!evalDoc.name || !evalDoc.description) findings.push("eval.yaml must carry name and description");

  const configs = loadConfigs();
  if (configs.length < 2) findings.push(`need at least two Configs, found ${configs.length}`);
  for (const c of configs) {
    if (!c.doc.runner) findings.push(`config ${c.name}: missing runner`);
    else if (!isExecutable(join(EVAL_DIR, "configs", c.doc.runner))) findings.push(`config ${c.name}: runner is not an executable file`);
    if (!c.doc.model) findings.push(`config ${c.name}: missing model`);
    // Explicit mapping to the two attribution axes (agent configuration + harness version).
    if (!c.doc.agent_configuration_id) findings.push(`config ${c.name}: missing agent_configuration_id`);
    if (!c.doc.harness_version) findings.push(`config ${c.name}: missing harness_version`);
  }

  const tasks = loadTasks();
  const scenarioSet = new Set(tasks.map((t) => t.doc.scenario));
  const scenarios = {};
  for (const s of REQUIRED_SCENARIOS) scenarios[s] = scenarioSet.has(s);
  for (const s of [...REQUIRED_SCENARIOS, INFRA_SCENARIO]) {
    if (!scenarioSet.has(s)) findings.push(`no task covers scenario '${s}'`);
  }

  for (const grader of listYaml(join(EVAL_DIR, "graders"))) {
    const doc = readYaml(join(EVAL_DIR, "graders", grader));
    for (const check of doc.checks ?? []) {
      if (check.model || check.rubric) findings.push(`grader ${grader}: check '${check.checker}' looks model-judge shaped; the PoC uses deterministic checkers only`);
      const checkerPath = join(EVAL_DIR, "graders", check.checker);
      if (!isExecutable(checkerPath)) findings.push(`grader ${grader}: checker '${check.checker}' is not an executable file`);
    }
  }

  // Containment: no smevals import under src/, no production manifest changes.
  // The meta test wrapper (src/meta/smevals-poc.test.ts) shells out to the PoC
  // scripts exactly like the docs-drift test wraps scripts/check-doc-drift.mjs;
  // it must not *import* the smevals package itself.
  const srcWalk = [];
  const walkSrc = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkSrc(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) srcWalk.push(full);
    }
  };
  if (existsSync(join(ROOT, "src"))) walkSrc(join(ROOT, "src"));
  const smevalsRefs = srcWalk.filter((f) => {
    const source = readFileSync(f, "utf8");
    // A real import/reference of the smevals package: module specifier or
    // spawn of the pinned CLI. Merely naming the PoC in comments/strings is
    // not a dependency edge.
    return (
      /(?:from\s+|require\(\s*|import\(\s*)"smevals/.test(source) ||
      /(?:from\s+|require\(\s*|import\(\s*)'smevals/.test(source) ||
      /uvx\s+--from\s+smevals/.test(source)
    );
  });
  if (smevalsRefs.length > 0) findings.push(`src/ imports or pins smevals: ${smevalsRefs.join(", ")}`);

  // Generated output must stay out of source control.
  const gitignore = existsSync(join(ROOT, ".gitignore")) ? readFileSync(join(ROOT, ".gitignore"), "utf8") : "";
  if (!gitignore.includes("validation-harness/runs")) findings.push(".gitignore must ignore eval/validation-harness/runs/");
  if (!gitignore.includes(".poc/")) findings.push(".gitignore must ignore .poc/");

  return {
    ok: findings.length === 0,
    findings,
    matrix: { tasks: tasks.map((t) => t.name), configs: configs.map((c) => c.name) },
    scenarios,
  };
}

// --- operations -------------------------------------------------------------

/** Run the given scenario tasks for one config (one sample per task). */
function runConfigTasks(configName, taskNames) {
  const args = ["run", relative(ROOT, EVAL_DIR), "-c", configName, ...runsDirArgs()];
  for (const t of taskNames) args.push("-t", t);
  return uvx(args, { cwd: ROOT });
}

/** Run the crash task for one config into the infra runs dir; failure is expected. */
function runCrashOnce(configName) {
  const args = ["run", relative(ROOT, EVAL_DIR), "-c", configName, "-t", INFRA_SCENARIO, "--runs-dir", relative(ROOT, INFRA_RUNS_DIR)];
  const res = uvx(args, { cwd: ROOT });
  // A non-zero Runner exit is an infrastructure failure: smevals exits non-zero,
  // the run is retained with run.yaml exit_code != 0, and it is never graded.
  if (res.status === 0) {
    throw new Error(`crash task unexpectedly succeeded for config ${configName}`);
  }
  return res;
}

function gradeAll() {
  return uvx(["grade", relative(ROOT, EVAL_DIR), ...runsDirArgs()], { cwd: ROOT });
}

function runMatrix(target = FULL_TARGET) {
  const configs = loadConfigs();
  const taskNames = loadTasks().map((t) => t.name).filter((n) => n !== INFRA_SCENARIO);
  const summary = [];
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const under = [];
    for (const c of configs) {
      for (const t of taskNames) {
        if (countSuccessfulRuns(t, c.name) < target) under.push({ config: c.name, task: t });
      }
    }
    if (under.length === 0) break;
    summary.push(`round ${round}: topping ${under.length} pair(s)`);
    // One invocation per config, running all still-under tasks for that config.
    for (const c of configs) {
      const still = under.filter((p) => p.config === c.name).map((p) => p.task);
      if (still.length === 0) continue;
      const res = runConfigTasks(c.name, still);
      if (res.status !== 0) throw new Error(`smevals run failed for config ${c.name}:\n${res.stdout}${res.stderr}`);
    }
  }
  const unsatisfied = [];
  for (const c of configs) {
    for (const t of taskNames) {
      const n = countSuccessfulRuns(t, c.name);
      if (n < target) unsatisfied.push(`${c.name}/${t} (${n} < ${target})`);
    }
  }
  if (unsatisfied.length > 0) throw new Error(`matrix did not reach ${target} successful samples: ${unsatisfied.join(", ")}`);
  return summary;
}

function crashDiagnostics() {
  const rows = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(join(full, "run.yaml"))) {
          const doc = readYaml(join(full, "run.yaml"));
          const stderrFile = join(full, "stderr.txt");
          const stderr = existsSync(stderrFile) ? readFileSync(stderrFile, "utf8").split("\n").slice(0, 5).join("\n") : "";
          rows.push({ run: relative(INFRA_RUNS_DIR, full), exit_code: doc.exit_code, stderr });
        } else {
          walk(full);
        }
      }
    }
  };
  if (existsSync(INFRA_RUNS_DIR)) walk(INFRA_RUNS_DIR);
  return rows;
}

function assertAllScenarioRunsPass() {
  const configs = loadConfigs();
  const taskNames = loadTasks().map((t) => t.name).filter((n) => n !== INFRA_SCENARIO);
  const failed = [];
  const root = effectiveRunsRoot();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (existsSync(join(full, "run.yaml"))) {
          const gradeFile = join(full, "grades", "default", "grade.yaml");
          if (existsSync(gradeFile) && readYaml(gradeFile).outcome !== "pass") failed.push(relative(root, full));
        } else {
          walk(full);
        }
      }
    }
  };
  if (existsSync(root)) walk(root);
  for (const c of configs) {
    for (const t of taskNames) {
      if (countSuccessfulRuns(t, c.name) === 0) failed.push(`${c.name}/${t}: no successful runs`);
    }
  }
  return failed;
}

// --- CLI --------------------------------------------------------------------

function cmdValidate(asJson) {
  const contract = staticContract();
  const infra = crashDiagnostics();
  if (asJson) {
    console.log(JSON.stringify({ ...contract, infra }, null, 2));
  } else {
    console.log(`smevals PoC contract: ${contract.ok ? "OK" : "FAIL"}`);
    console.log(`  matrix: ${contract.matrix.configs.join(", ")} x ${contract.matrix.tasks.join(", ")}`);
    for (const [s, ok] of Object.entries(contract.scenarios)) console.log(`  scenario ${s}: ${ok ? "covered" : "MISSING"}`);
    if (!contract.ok) {
      for (const f of contract.findings) console.log(`  ✗ ${f}`);
      console.log("  infra runs retained:", infra.length);
      process.exit(1);
    }
    console.log("  infra runs retained:", infra.length);
  }
  if (!contract.ok) process.exit(1);
}

function cmdSmoke() {
  const contract = staticContract();
  if (!contract.ok) {
    for (const f of contract.findings) console.error(`✗ ${f}`);
    process.exit(1);
  }
  console.log("smoke: running one successful sample per pair + crash retention");
  const taskNames = loadTasks().map((t) => t.name).filter((n) => n !== INFRA_SCENARIO);
  for (const c of loadConfigs()) {
    const res = runConfigTasks(c.name, taskNames);
    if (res.status !== 0) throw new Error(`smoke run failed for ${c.name}:\n${res.stdout}${res.stderr}`);
    console.log(`  ${c.name}: ${taskNames.join(", ")}`);
    runCrashOnce(c.name);
    console.log(`  ${c.name}: ${INFRA_SCENARIO} retained as infrastructure failure`);
  }
  const grade = gradeAll();
  if (grade.status !== 0) throw new Error(`smevals grade failed:\n${grade.stdout}${grade.stderr}`);
  console.log("smoke: graded OK");
  const failed = assertAllScenarioRunsPass();
  if (failed.length > 0) throw new Error(`smoke: graded failures: ${failed.join(", ")}`);
  console.log("smoke: complete");
}

function cmdFull() {
  const contract = staticContract();
  if (!contract.ok) {
    for (const f of contract.findings) console.error(`✗ ${f}`);
    process.exit(1);
  }
  const before = countAllRunsMatrix();
  console.log(`full: top every pair up to ${FULL_TARGET} successful samples (idempotent)`);
  const summary = runMatrix(FULL_TARGET);
  for (const line of summary) console.log(`  ${line}`);
  // Crash retention runs once per config (already run in smoke; ensure here too).
  for (const c of loadConfigs()) runCrashOnce(c.name);
  const grade = gradeAll();
  if (grade.status !== 0) throw new Error(`smevals grade failed:\n${grade.stdout}${grade.stderr}`);
  console.log("full: graded OK");
  const failed = assertAllScenarioRunsPass();
  if (failed.length > 0) throw new Error(`full: graded failures: ${failed.join(", ")}`);
  const after = countAllRunsMatrix();
  console.log(`full: complete (${after} pair-runs total, was ${before})`);
}

function countAllRunsMatrix() {
  const configs = loadConfigs();
  const taskNames = loadTasks().map((t) => t.name).filter((n) => n !== INFRA_SCENARIO);
  let n = 0;
  for (const c of configs) for (const t of taskNames) n += countAllRuns(t, c.name);
  return n;
}

function cmdResume() {
  const contract = staticContract();
  if (!contract.ok) {
    for (const f of contract.findings) console.error(`✗ ${f}`);
    process.exit(1);
  }
  const before = countAllRunsMatrix();
  const summary = runMatrix(FULL_TARGET);
  const after = countAllRunsMatrix();
  const added = after - before;
  console.log("resume: top up any pair below 3 from on-disk runs");
  for (const line of summary) console.log(`  ${line}`);
  console.log(`resume: ${before} pair-runs before, ${after} after, ${added} new`);
  if (added < 0) throw new Error("resume removed runs — invariant broken");
  console.log(`resume: ${added === 0 ? "no duplicates — already complete" : "topped up without duplicating"} ✓`);
}

function cmdRegrade() {
  const contract = staticContract();
  if (!contract.ok) {
    for (const f of contract.findings) console.error(`✗ ${f}`);
    process.exit(1);
  }
  const beforeSnap = snapshotRunArtifacts();
  const res = uvx(["grade", relative(ROOT, EVAL_DIR), "--regrade", ...runsDirArgs()], { cwd: ROOT });
  if (res.status !== 0) throw new Error(`regrade failed:\n${res.stdout}${res.stderr}`);
  const afterSnap = snapshotRunArtifacts();
  const changed = [...afterSnap.keys()].filter((k) => beforeSnap.get(k) !== afterSnap.get(k));
  if (changed.length > 0) {
    throw new Error(`regrade mutated run evidence (Runner re-executed?): ${changed.join(", ")}`);
  }
  console.log("regrade: grades regenerated from stored runs, no Runner execution ✓");
}

function cmdReport() {
  const contract = staticContract();
  if (!contract.ok) {
    for (const f of contract.findings) console.error(`✗ ${f}`);
    process.exit(1);
  }
  const res = uvx(["report", relative(ROOT, EVAL_DIR), "--by-task", ...runsDirArgs()], { cwd: ROOT });
  if (res.status !== 0) throw new Error(`report failed:\n${res.stdout}${res.stderr}`);
  const infra = crashDiagnostics();
  const appendix = [
    "",
    "---",
    "",
    "## Infrastructure failures (excluded from graded statistics)",
    "",
    "Non-zero Runner exits are retained for diagnosis and are never graded as",
    "model/agent-configuration failures. These runs live in `.poc/runs-infra/`",
    "and do not appear in the graded report above.",
    "",
    ...(infra.length === 0
      ? ["_No infrastructure-failure runs retained._"]
      : infra.map(
          (r) => `- \`${r.run}\` — exit ${r.exit_code}${r.stderr ? `\n  stderr: \`${r.stderr.replace(/\n/g, " | ")}\`` : ""}`,
        )),
    "",
  ];
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(REPORT_MD, `${res.stdout.trimEnd()}\n${appendix.join("\n")}`);
  console.log(res.stdout.trimEnd());
  console.log(`\nReport written to ${REPORT_MD}`);
}

function cmdBuild() {
  const contract = staticContract();
  if (!contract.ok) {
    for (const f of contract.findings) console.error(`✗ ${f}`);
    process.exit(1);
  }
  const res = uvx(["build", relative(ROOT, EVAL_DIR), "-o", relative(ROOT, SITE_DIR)], { cwd: ROOT });
  if (res.status !== 0) throw new Error(`build failed:\n${res.stdout}${res.stderr}`);
  console.log(res.stdout.trimEnd());
  console.log(`Static site: ${join(SITE_DIR, "index.html")}`);
}

/** Executable artifact/schema check over one run directory (used by tests). */
function cmdCheckEvidence(runDir) {
  const problems = checkRunEvidence(runDir);
  console.log(JSON.stringify({ ok: problems.length === 0, problems }, null, 2));
  process.exit(problems.length === 0 ? 0 : 1);
}

const COMMANDS = { validate: cmdValidate, smoke: cmdSmoke, full: cmdFull, resume: cmdResume, regrade: cmdRegrade, report: cmdReport, build: cmdBuild, "check-evidence": cmdCheckEvidence };

// Keep this module importable by vitest without side effects (docs-drift pattern).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, flag, arg] = process.argv.slice(2);
  if (!COMMANDS[command]) {
    console.error(`usage: node scripts/smevals-poc.mjs <${Object.keys(COMMANDS).join("|")}> [--json] [runDir]`);
    process.exit(2);
  }
  if (command === "validate" && flag === "--json") {
    cmdValidate(true);
  } else if (command === "check-evidence") {
    COMMANDS[command](flag);
  } else {
    COMMANDS[command]();
  }
}
