import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SYSTEM_CANDIDATES = [
  "/opt/pw-browsers/chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/google/chrome/chrome",
];

async function isExecutable(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function playwrightCacheCandidates(cacheRoot) {
  let entries = [];
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("chromium"))
    .flatMap((entry) => [
      join(cacheRoot, entry.name, "chrome-linux", "chrome"),
      join(cacheRoot, entry.name, "chrome-linux64", "chrome"),
    ]);
}

export async function resolveChromiumExecutable({
  override = process.env.CHROMIUM_PATH,
  cacheRoot = join(homedir(), ".cache", "ms-playwright"),
  systemCandidates = SYSTEM_CANDIDATES,
} = {}) {
  const candidates = [
    ...(override ? [override] : []),
    ...systemCandidates,
    ...(await playwrightCacheCandidates(cacheRoot)),
  ];

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return { executablePath: candidate, checkedPaths: candidates };
    }
  }

  throw new Error(
    [
      "No usable Chrome or Chromium executable was found.",
      "Set CHROMIUM_PATH to an executable browser path.",
      "Paths checked:",
      ...candidates.map((candidate) => `  - ${candidate}`),
    ].join("\n"),
  );
}
