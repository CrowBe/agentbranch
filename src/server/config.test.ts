import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_NOUS_BASE_URL,
  DEFAULT_NOUS_MODEL,
  readConfig,
} from "./config";

const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("readConfig", () => {
  it("defaults to Anthropic and offline model mode with no provider key", () => {
    replaceEnv({});

    const config = readConfig();

    expect(config.modelProvider).toBe("anthropic");
    expect(config.modelId).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(config.flags.hasModel).toBe(false);
  });

  it("uses Nous defaults when Nous is the selected provider", () => {
    replaceEnv({
      SKILLBUILDER_MODEL_PROVIDER: "nous",
      NOUS_API_KEY: "nous-key",
    });

    const config = readConfig();

    expect(config.modelProvider).toBe("nous");
    expect(config.nousApiKey).toBe("nous-key");
    expect(config.nousBaseUrl).toBe(DEFAULT_NOUS_BASE_URL);
    expect(config.modelId).toBe(DEFAULT_NOUS_MODEL);
    expect(config.flags.hasModel).toBe(true);
  });

  it("auto-selects Nous when only a Nous key is present", () => {
    replaceEnv({
      NOUS_API_KEY: "nous-key",
    });

    const config = readConfig();

    expect(config.modelProvider).toBe("nous");
    expect(config.modelId).toBe(DEFAULT_NOUS_MODEL);
    expect(config.flags.hasModel).toBe(true);
  });

  it("lets explicit model and Nous base URL override defaults", () => {
    replaceEnv({
      SKILLBUILDER_MODEL_PROVIDER: "nous",
      NOUS_API_KEY: "nous-key",
      NOUS_BASE_URL: "https://example.test/v1",
      SKILLBUILDER_MODEL: "Hermes-4-70B",
    });

    const config = readConfig();

    expect(config.nousBaseUrl).toBe("https://example.test/v1");
    expect(config.modelId).toBe("Hermes-4-70B");
  });

  it("rejects unsupported model providers", () => {
    replaceEnv({
      SKILLBUILDER_MODEL_PROVIDER: "bogus",
    });

    expect(() => readConfig()).toThrow(/Unsupported SKILLBUILDER_MODEL_PROVIDER/);
  });
});

function replaceEnv(env: Record<string, string>): void {
  process.env = { ...ORIGINAL_ENV, ...env };
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NOUS_API_KEY;
  delete process.env.NOUS_BASE_URL;
  delete process.env.SKILLBUILDER_MODEL;
  delete process.env.SKILLBUILDER_MODEL_PROVIDER;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  Object.assign(process.env, env);
}
