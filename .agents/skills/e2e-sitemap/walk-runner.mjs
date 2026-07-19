// Executable form of sitemap.md — runs every walk against a local dev server
// and prints a PASS/FAIL matrix. Run from the repo root (module resolution
// walks up to the repo's node_modules):
//
//   node .agents/skills/e2e-sitemap/walk-runner.mjs
//
// Expects a fresh `npm run dev` session (memory adapters empty — see
// sitemap.md §2 on the five-skill account cap) and no model key, so the
// offline expectations apply. Override the browser with CHROMIUM_PATH.
import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROMIUM = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const results = [];
let page;

const FIXTURE = `---
name: inbox-triage
description: Sort unread email into respond, archive, and escalate piles.
---

# Inbox triage

## Workflow
1. Fetch unread email.
2. Classify each message as respond, archive, or escalate.
3. Summarise the respond pile.
`;

const SKILL_PAYLOAD = {
  skill: {
    frontmatter: {
      name: "inbox-triage",
      description: "Sort unread email into respond, archive, and escalate piles.",
    },
    body: "# Inbox triage\n\n1. Fetch unread email.",
  },
};

async function status(text, timeout = 15000) {
  await page.locator('[role="status"]').filter({ hasText: text }).waitFor({ timeout });
}
async function walk(name, fn) {
  try {
    await fn();
    results.push([name, "PASS"]);
  } catch (e) {
    results.push([name, `FAIL: ${String(e).split("\n")[0]}`]);
    try {
      await page.screenshot({ path: `fail-${name.replaceAll(" ", "_")}.png` });
    } catch {}
  }
}

const browser = await chromium.launch({ executablePath: CHROMIUM });
page = await browser.newPage();
// Dialog policy (sitemap §1): accept confirms, dismiss the safety-rating offer.
page.on("dialog", (d) =>
  d.message().startsWith("Optional: run a safety rating") ? d.dismiss() : d.accept(),
);

await walk("WALK-01 import", async () => {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByRole("button", { name: "Import" }).first().click();
  await page.getByText("Import a skill").first().waitFor();
  await page.locator("textarea").fill(FIXTURE);
  await page.getByRole("button", { name: "Import skill" }).click();
  await status("Import complete.");
  await page.getByRole("heading", { name: /inbox.triage/i }).first().waitFor();
});

await walk("WALK-02 hero views", async () => {
  await page.getByRole("button", { name: "Source" }).click();
  await page.getByText("Sort unread email into respond").first().waitFor();
  await page.getByRole("button", { name: "Rendered" }).click();
});

await walk("WALK-03 quality", async () => {
  await page.locator('button[aria-label^="Quality"]').click();
  await status("Quality ready.");
});

await walk("WALK-04 visualise", async () => {
  await page.getByRole("button", { name: "Visualise", exact: true }).click();
  await status("Visualise ready.");
});

await walk("WALK-04B metadata suggestion", async () => {
  await page.getByRole("button", { name: "Metadata", exact: true }).click();
  await status("Metadata ready.");
  await page.getByText(/^(Metadata suggestion|Suggested on your device)$/).waitFor();
  await page.getByRole("button", { name: "Apply suggestion", exact: true }).click();
  await status("Suggestion applied and saved.");
});

await walk("WALK-05 export", async () => {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await status("Export ready.");
});

await walk("WALK-06 my skills open", async () => {
  await page.getByRole("button", { name: "My skills" }).first().click();
  await page.getByText("inbox-triage").first().waitFor();
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await status("Skill opened.");
  await page.getByText("Viewing the main version").waitFor();
});

await walk("WALK-07 draft lifecycle", async () => {
  await page.getByRole("button", { name: "Start a draft" }).click();
  await status("Draft started. Your main version is unchanged.");
  await page.getByText("Editing a draft").waitFor();
  await page.getByRole("button", { name: "Set as main version" }).click();
  await status("This draft is now your main version.");
  await page.getByRole("button", { name: "Start a draft" }).click();
  await status("Draft started.");
  await page.getByRole("button", { name: "Discard draft" }).click();
  await status("Draft discarded. Back to your main version.");
  await page.getByText("Viewing the main version").waitFor();
});

await walk("WALK-08 offline eval probes", async () => {
  for (const chip of ["Run", "Triggers", "Safety"]) {
    await page.getByRole("button", { name: chip, exact: true }).click();
    await status("No model is configured.");
  }
});

await walk("WALK-09 history", async () => {
  await page.getByRole("button", { name: "History" }).first().click();
  await status("History loaded.");
});

await walk("WALK-10 equipment", async () => {
  await page.getByRole("button", { name: "Equipment" }).first().click();
  // Non-JSON input routes to the chat authoring loop — offline it fails with
  // the provider-specific key message.
  await page.locator("textarea").fill("a schema for invoice summaries");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await status("No API key for", 20000);
  // A pasted JSON Schema is quality-checked and kept.
  await page
    .locator("textarea")
    .fill('{"title":"Invoice summary","type":"object","properties":{"total":{"type":"number"}}}');
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await status('Response schema "Invoice summary" checked and kept for tool contracts to reference.');
  // A pasted tool contract is checked and bundles into the next test run.
  await page
    .locator("textarea")
    .fill(
      '{"name":"fetch_unread_email","description":"Fetch unread messages from the inbox.","input":{"type":"object","properties":{"limit":{"type":"number"}}},"output":{"type":"array"}}',
    );
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await status('Tool contract "fetch_unread_email" checked — it runs with your next test run.');
});

await walk("WALK-11 templates", async () => {
  await page.getByRole("button", { name: "Templates" }).first().click();
  await status("No Templates yet."); // offline: no publications in memory
  await page.locator("textarea").fill("inbox");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await status("No matching Templates.");
});

await walk("WALK-12 model console", async () => {
  await page.getByRole("button", { name: "Models" }).first().click();
  await page.getByText(/provider/i).first().waitFor();
});

await walk("WALK-13 profile 404", async () => {
  const res = await page.goto(BASE + "/skills/nobody/does-not-exist", {
    waitUntil: "domcontentloaded",
  });
  if (res.status() !== 404) throw new Error(`expected 404, got ${res.status()}`);
});

await browser.close();

// WALK-14 API probes (curl-level, no browser)
async function probe(name, path, opts, check) {
  try {
    const res = await fetch(BASE + path, opts);
    await check(res);
    results.push([name, "PASS"]);
  } catch (e) {
    results.push([name, `FAIL: ${String(e).split("\n")[0]}`]);
  }
}
const json = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
await probe("WALK-14 lint", "/api/lint", json(SKILL_PAYLOAD), async (r) => {
  if (!r.ok) throw new Error(`lint ${r.status}: ${await r.text()}`);
});
await probe("WALK-14 test-run offline 503", "/api/test-run", json(SKILL_PAYLOAD), async (r) => {
  if (r.status !== 503) throw new Error(`expected 503, got ${r.status}`);
});
await probe("WALK-14 skill-library", "/api/skill-library?surface=templates", {}, async (r) => {
  if (!r.ok) throw new Error(`got ${r.status}`);
});
await probe("WALK-14 tap-repository", "/api/tap-repository", {}, async (r) => {
  if (!r.ok) throw new Error(`got ${r.status}`);
});
await probe("WALK-14 cron locked", "/api/cron/retention", {}, async (r) => {
  if (r.status !== 401 && r.status !== 403) throw new Error(`expected 401/403, got ${r.status}`);
});
await probe("WALK-14 model-router snapshot", "/api/model-router", {}, async (r) => {
  const body = await r.text();
  if (!r.ok) throw new Error(`got ${r.status}`);
  if (/sk-ant|api[_-]?key"\s*:\s*"[^"]/.test(body)) throw new Error("key material in snapshot?");
});

for (const [name, outcome] of results)
  console.log(outcome.startsWith("PASS") ? `✅ ${name}` : `❌ ${name} — ${outcome}`);
process.exit(results.some(([, o]) => o.startsWith("FAIL")) ? 1 : 0);
