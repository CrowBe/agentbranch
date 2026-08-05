import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Executable contract checks for the removable smevals validation-harness PoC
 * (agentbranch #301). Runs the orchestrator as a subprocess (docs-drift
 * pattern) so this test stays decoupled from the .mjs module internals.
 *
 * The deterministic matrix is executed against a redirected runs dir under the
 * OS temp dir when uv (and therefore pinned smevals) is available; the static
 * contract and artifact/schema guarantees are checked offline regardless.
 */
const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
const POC = join(ROOT, "scripts", "smevals-poc.mjs");
const EVAL_DIR = join(ROOT, "eval", "validation-harness");

function runNode(args: string[], env: Record<string, string> = {}) {
  return spawnSync("node", [POC, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

const hasUv = (() => {
  const res = spawnSync("uvx", ["--version"], { encoding: "utf8" });
  return res.status === 0;
})();

function tempRunsDir() {
  return join(tmpdir(), `smevals-poc-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

describe("smevals validation-harness PoC contract", () => {
  it("executes the focused Runner contract suite", () => {
    const res = spawnSync(process.execPath, ["--test", join(EVAL_DIR, "runner.test.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(res.status, `Runner tests exited ${res.status}: ${res.stdout}${res.stderr}`).toBe(0);
  });

  it("defines a deterministic matrix with at least two Configs and full scenario coverage", () => {
    const res = runNode(["validate", "--json"]);
    expect(res.status, `validate exited ${res.status}: ${res.stderr}`).toBe(0);
    const contract = JSON.parse(res.stdout);
    expect(contract.ok).toBe(true);
    expect(contract.findings).toEqual([]);
    expect(contract.matrix.configs.length).toBeGreaterThanOrEqual(2);
    expect(contract.matrix.tasks.length).toBeGreaterThanOrEqual(7);
    for (const scenario of [
      "skill-activation",
      "skill-non-activation",
      "tool-selection-exact-arguments",
      "delegation-routing",
      "forbidden-behaviour",
      "partial-tool-failure-recovery",
    ]) {
      expect(contract.scenarios[scenario], `missing scenario coverage: ${scenario}`).toBe(true);
    }
  });

  it("retains complete evidence for a successful run and rejects secret-shaped artifacts", () => {
    const okFixture = join(EVAL_DIR, "fixtures", "run-ok");
    const leakedFixture = join(EVAL_DIR, "fixtures", "run-leaked-secret");
    expect(existsSync(okFixture)).toBe(true);
    expect(existsSync(leakedFixture)).toBe(true);

    const ok = runNode(["check-evidence", okFixture]);
    expect(ok.status, `evidence fixture should pass: ${ok.stdout}`).toBe(0);
    expect(JSON.parse(ok.stdout).ok).toBe(true);

    const leaked = runNode(["check-evidence", leakedFixture]);
    expect(leaked.status).toBe(1);
    const problems = JSON.parse(leaked.stdout).problems;
    expect(problems.join("\n")).toMatch(/secret|SMEVALS_|process\.env/i);
  });

  it("resumes without duplicating completed samples and regrades without rerunning the Runner", { skip: !hasUv, timeout: 180_000 }, () => {
    const runsDir = tempRunsDir();
    const infraDir = tempRunsDir();
    const env = { SMEVALS_POC_RUNS_DIR: runsDir, SMEVALS_POC_INFRA_RUNS_DIR: infraDir };
    try {
      // Smoke: one successful sample per pair, then resume to three.
      const smoke = runNode(["smoke"], env);
      expect(smoke.status, `smoke failed: ${smoke.stdout}${smoke.stderr}`).toBe(0);
      const first = runNode(["resume"], env);
      expect(first.status, `resume failed: ${first.stdout}${first.stderr}`).toBe(0);
      expect(first.stdout).toMatch(/topped up without duplicating/);
      const second = runNode(["resume"], env);
      expect(second.status, `second resume failed: ${second.stdout}${second.stderr}`).toBe(0);
      expect(second.stdout).toMatch(/no duplicates/);

      // Regrade: grades are regenerated from stored runs; run evidence is untouched.
      const regrade = runNode(["regrade"], env);
      expect(regrade.status, `regrade failed: ${regrade.stdout}${regrade.stderr}`).toBe(0);
      expect(regrade.stdout).toMatch(/no Runner execution/);

      // Infra-failure runs are retained in their own tree, never graded.
      expect(readdirSync(join(infraDir, "validation-harness")).length).toBeGreaterThan(0);
    } finally {
      execFileSync("rm", ["-rf", runsDir, infraDir], { stdio: "ignore" });
    }
  });
});
