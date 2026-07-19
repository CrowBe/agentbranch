import { AppShell } from "@/components/app-shell";
import { makeSkill, parseSkillMd } from "@/modules/skill";
import { runCapability } from "@/modules/skill-analysis";
import { heroCapability } from "@/modules/hero";
import { createLintSummary } from "@/modules/lint";
import { formatQuotaMicros, INITIAL_QUOTA_MICROS, quotaRemainingMicros } from "@/modules/usage";
import { getContainer } from "@/server/container";
import { unwrap, SkillId, UserId } from "@/shared";

// The top bar shows the signed-in user's remaining free quota, so the page
// renders per request rather than prerendering at build.
export const dynamic = "force-dynamic";

// A demo skill so the shell renders a real document through the seam. Replace
// with the user's streaming skill once the build loop is fully wired.
const DEMO_SKILL = `---
name: inbox-triage
description: Sorts unread email into respond, archive, or escalate, and drafts replies for the ones that need them.
---

# Goal

Help the user clear their inbox by triaging unread mail into three buckets and drafting replies where useful.

# Workflow

1. Fetch unread email.
2. For each message, decide: respond, archive, or escalate.
3. Draft a reply for anything in "respond".

# Constraints

Never auto-send a reply. Always leave drafts for the user to review and send.
`;

/** The free-quota chip text: the remaining balance in dollars (ARCHITECTURE §8). */
async function readQuotaLabel(): Promise<string> {
  const container = getContainer();
  let remaining = INITIAL_QUOTA_MICROS;
  const identity = await container.auth.currentIdentity();
  if (identity.ok && identity.value) {
    const snapshot = await container.usage.get(identity.value.userId);
    if (snapshot.ok) remaining = quotaRemainingMicros(snapshot.value);
  }
  return `${formatQuotaMicros(remaining)} free quota`;
}

export default async function Home() {
  const source = unwrap(parseSkillMd(DEMO_SKILL));
  const skill = makeSkill({
    id: SkillId("demo"),
    userId: UserId("dev-user"),
    source,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const rendered = unwrap(await runCapability(heroCapability, "rendered", skill));
  const sourceDoc = unwrap(await runCapability(heroCapability, "source", skill));

  return (
    <AppShell
      rendered={rendered}
      source={sourceDoc}
      initialSkill={source}
      initialLintSummary={createLintSummary(source)}
      quotaLabel={await readQuotaLabel()}
    />
  );
}
