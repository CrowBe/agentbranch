import { describe, expect, it, vi } from "vitest";
import { createGithubSkillImportFetcher } from "./skill-import-fetcher";
import { isErr, unwrap } from "@/shared";

const skillMd = "---\nname: inbox-triage\ndescription: Sort unread mail.\n---\n# Steps\nRead mail.";

describe("GitHub skill import fetcher", () => {
  it("normalizes GitHub blob URLs to raw SKILL.md fetches", async () => {
    const fetchMock = vi.fn(async () => new Response(skillMd, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }));

    const fetcher = createGithubSkillImportFetcher(fetchMock as unknown as typeof fetch);
    const result = await fetcher.fetchSkillMd(
      "https://github.com/acme/skills/blob/main/inbox/SKILL.md",
    );

    expect(unwrap(result)).toBe(skillMd);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://raw.githubusercontent.com/acme/skills/main/inbox/SKILL.md"),
      expect.objectContaining({ credentials: "omit", redirect: "manual" }),
    );
  });

  it("resolves GitHub folder URLs to SKILL.md", async () => {
    const fetchMock = vi.fn(async () => new Response(skillMd, {
      headers: { "content-type": "text/plain" },
    }));

    const fetcher = createGithubSkillImportFetcher(fetchMock as unknown as typeof fetch);
    const result = await fetcher.fetchSkillMd("https://github.com/acme/skills/tree/main/inbox");

    expect(unwrap(result)).toBe(skillMd);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://raw.githubusercontent.com/acme/skills/main/inbox/SKILL.md"),
      expect.objectContaining({ credentials: "omit", redirect: "manual" }),
    );
  });

  it("rejects non-GitHub hosts without fetching", async () => {
    const fetchMock = vi.fn();
    const fetcher = createGithubSkillImportFetcher(fetchMock as unknown as typeof fetch);

    const result = await fetcher.fetchSkillMd("https://example.test/SKILL.md");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("invalid_url");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects instead of following off-allowlist targets", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://example.test/SKILL.md" },
    }));
    const fetcher = createGithubSkillImportFetcher(fetchMock as unknown as typeof fetch);

    const result = await fetcher.fetchSkillMd("https://github.com/acme/skills/blob/main/SKILL.md");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("invalid_url");
  });

  it("rejects oversized responses by header", async () => {
    const fetchMock = vi.fn(async () => new Response("", {
      headers: { "content-type": "text/plain", "content-length": "256001" },
    }));
    const fetcher = createGithubSkillImportFetcher(fetchMock as unknown as typeof fetch);

    const result = await fetcher.fetchSkillMd("https://github.com/acme/skills/blob/main/SKILL.md");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("too_large");
  });
});
