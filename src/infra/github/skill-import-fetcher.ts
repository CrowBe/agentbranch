import { err, ok, REQUEST_BYTES_MAX, LIMIT_MESSAGES } from "@/shared";
import type { SkillImportFetcher, SkillImportFetchError } from "@/modules/skill-import";

type FetchLike = typeof fetch;

const ALLOWED_HOSTS = new Set(["github.com", "raw.githubusercontent.com"]);
const FETCH_TIMEOUT_MS = 8_000;

export function createGithubSkillImportFetcher(fetchImpl: FetchLike = fetch): SkillImportFetcher {
  return {
    async fetchSkillMd(url: string) {
      const target = normalizeGithubSkillUrl(url);
      if (!target.ok) return target;

      const response = await fetchWithTimeout(fetchImpl, target.value);
      if (!response.ok) {
        return err({
          kind: "fetch_failed",
          message: "We couldn't fetch that GitHub URL. Check that it is public and try again.",
        });
      }

      if (isRedirect(response.value.status)) {
        const location = response.value.headers.get("location");
        if (!location) {
          return err({ kind: "not_found", message: "That GitHub URL did not point to a SKILL.md file." });
        }
        const redirect = normalizeGithubSkillUrl(location);
        if (!redirect.ok) return redirect;
        if (redirect.value.href !== target.value.href) {
          return err({
            kind: "invalid_url",
            message: "GitHub URL redirects must stay on github.com or raw.githubusercontent.com.",
          });
        }
        return err({ kind: "not_found", message: "That GitHub URL did not point to a SKILL.md file." });
      }

      if (response.value.status === 404) {
        return err({ kind: "not_found", message: "That GitHub URL did not point to a SKILL.md file." });
      }
      if (!response.value.ok) {
        return err({
          kind: "fetch_failed",
          message: "We couldn't fetch that GitHub URL. Check that it is public and try again.",
        });
      }

      const contentLength = response.value.headers.get("content-length");
      if (contentLength && Number(contentLength) > REQUEST_BYTES_MAX) {
        return err({ kind: "too_large", message: LIMIT_MESSAGES.requestBytes });
      }

      const contentType = response.value.headers.get("content-type") ?? "";
      if (contentType && !isTextContentType(contentType)) {
        return err({ kind: "not_text", message: "GitHub imports need to point to a text SKILL.md file." });
      }

      return readBoundedText(response.value);
    },
  };
}

function normalizeGithubSkillUrl(url: string): import("@/shared").Result<URL, SkillImportFetchError> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err({ kind: "invalid_url", message: "Enter a valid GitHub URL." });
  }

  if (parsed.protocol !== "https:") {
    return err({ kind: "invalid_url", message: "GitHub imports need an https URL." });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return err({
      kind: "invalid_url",
      message: "Import from GitHub URLs only: github.com or raw.githubusercontent.com.",
    });
  }

  if (parsed.hostname === "raw.githubusercontent.com") return normalizeRawUrl(parsed);
  return normalizeGithubWebUrl(parsed);
}

function normalizeRawUrl(url: URL): import("@/shared").Result<URL, SkillImportFetchError> {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4) {
    return err({ kind: "invalid_url", message: "Point to a SKILL.md file or skill folder on GitHub." });
  }

  if (parts.at(-1) !== "SKILL.md") parts.push("SKILL.md");
  return ok(new URL(`https://raw.githubusercontent.com/${parts.map(encodeURIComponent).join("/")}`));
}

function normalizeGithubWebUrl(url: URL): import("@/shared").Result<URL, SkillImportFetchError> {
  const parts = url.pathname.split("/").filter(Boolean);
  const [owner, repo, kind, ref, ...path] = parts;
  if (!owner || !repo || !kind || !ref) {
    return err({ kind: "invalid_url", message: "Point to a SKILL.md file or skill folder on GitHub." });
  }
  if (kind !== "blob" && kind !== "tree" && kind !== "raw") {
    return err({ kind: "invalid_url", message: "Point to a SKILL.md file or skill folder on GitHub." });
  }

  const rawPath = kind === "tree" && path.at(-1) !== "SKILL.md" ? [...path, "SKILL.md"] : path;
  if (rawPath.length === 0 || rawPath.at(-1) !== "SKILL.md") {
    return err({ kind: "invalid_url", message: "Point to a SKILL.md file or skill folder on GitHub." });
  }

  return ok(new URL(
    `https://raw.githubusercontent.com/${[owner, repo, ref, ...rawPath]
      .map(encodeURIComponent)
      .join("/")}`,
  ));
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: URL,
): Promise<import("@/shared").Result<Response, SkillImportFetchError>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return ok(await fetchImpl(url, {
      redirect: "manual",
      signal: controller.signal,
      credentials: "omit",
    }));
  } catch {
    return err({
      kind: "fetch_failed",
      message: "We couldn't fetch that GitHub URL. Check that it is public and try again.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isTextContentType(contentType: string): boolean {
  return /^(text\/|application\/(?:json|yaml|x-yaml|octet-stream)\b)/i.test(contentType);
}

async function readBoundedText(response: Response): Promise<
  import("@/shared").Result<string, SkillImportFetchError>
> {
  const reader = response.body?.getReader();
  if (!reader) return ok(await response.text());

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > REQUEST_BYTES_MAX) {
      await reader.cancel();
      return err({ kind: "too_large", message: LIMIT_MESSAGES.requestBytes });
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(new TextDecoder().decode(bytes));
}
