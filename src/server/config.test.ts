import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ANTHROPIC_CLASSIFY_MODEL,
  DEFAULT_ANTHROPIC_GENERATE_MODEL,
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
    expect(config.modelIds).toEqual({
      default: DEFAULT_ANTHROPIC_MODEL,
      classify: DEFAULT_ANTHROPIC_CLASSIFY_MODEL,
      generate: DEFAULT_ANTHROPIC_GENERATE_MODEL,
      runAgent: DEFAULT_ANTHROPIC_MODEL,
      streamAgent: DEFAULT_ANTHROPIC_MODEL,
    });
    expect(config.flags.hasModel).toBe(false);
  });

  it("uses Nous defaults when Nous is the selected provider", () => {
    replaceEnv({
      AGENTBRANCH_MODEL_PROVIDER: "nous",
      NOUS_API_KEY: "nous-key",
    });

    const config = readConfig();

    expect(config.modelProvider).toBe("nous");
    expect(config.nousApiKey).toBe("nous-key");
    expect(config.nousBaseUrl).toBe(DEFAULT_NOUS_BASE_URL);
    expect(config.modelId).toBe(DEFAULT_NOUS_MODEL);
    expect(config.modelIds).toEqual({
      default: DEFAULT_NOUS_MODEL,
      classify: DEFAULT_NOUS_MODEL,
      generate: DEFAULT_NOUS_MODEL,
      runAgent: DEFAULT_NOUS_MODEL,
      streamAgent: DEFAULT_NOUS_MODEL,
    });
    expect(config.flags.hasModel).toBe(true);
    expect(
      config.providerRegistry.find((profile) => profile.id === "nous")?.structuredOutputs,
    ).toBe("json");
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
      AGENTBRANCH_MODEL_PROVIDER: "nous",
      NOUS_API_KEY: "nous-key",
      NOUS_BASE_URL: "https://example.test/v1",
      AGENTBRANCH_MODEL: "Hermes-4-70B",
    });

    const config = readConfig();

    expect(config.nousBaseUrl).toBe("https://example.test/v1");
    expect(config.modelId).toBe("Hermes-4-70B");
  });

  it("lets primitive model routes override the provider defaults", () => {
    replaceEnv({
      ANTHROPIC_API_KEY: "anthropic-key",
      AGENTBRANCH_MODEL: "claude-opus-custom",
      AGENTBRANCH_CLASSIFY_MODEL: "claude-haiku-custom",
      AGENTBRANCH_GENERATE_MODEL: "claude-sonnet-custom",
      AGENTBRANCH_RUN_AGENT_MODEL: "claude-run-custom",
      AGENTBRANCH_STREAM_AGENT_MODEL: "claude-stream-custom",
    });

    const config = readConfig();

    expect(config.modelIds).toEqual({
      default: "claude-opus-custom",
      classify: "claude-haiku-custom",
      generate: "claude-sonnet-custom",
      runAgent: "claude-run-custom",
      streamAgent: "claude-stream-custom",
    });
  });

  it("rejects unsupported model providers", () => {
    replaceEnv({
      AGENTBRANCH_MODEL_PROVIDER: "bogus",
    });

    expect(() => readConfig()).toThrow(/Unsupported AGENTBRANCH_MODEL_PROVIDER/);
  });

  it("accepts an explicit Nous structured-output mode", () => {
    replaceEnv({ NOUS_STRUCTURED_OUTPUTS: "none" });

    expect(
      readConfig().providerRegistry.find((profile) => profile.id === "nous")?.structuredOutputs,
    ).toBe("none");
  });

  it("rejects an unsupported Nous structured-output mode", () => {
    replaceEnv({ NOUS_STRUCTURED_OUTPUTS: "xml" });

    expect(() => readConfig()).toThrow(/Unsupported NOUS_STRUCTURED_OUTPUTS/);
  });
});

function replaceEnv(env: Record<string, string>): void {
  process.env = { ...ORIGINAL_ENV, ...env };
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NOUS_API_KEY;
  delete process.env.NOUS_BASE_URL;
  delete process.env.NOUS_STRUCTURED_OUTPUTS;
  delete process.env.AGENTBRANCH_MODEL;
  delete process.env.AGENTBRANCH_CLASSIFY_MODEL;
  delete process.env.AGENTBRANCH_GENERATE_MODEL;
  delete process.env.AGENTBRANCH_RUN_AGENT_MODEL;
  delete process.env.AGENTBRANCH_STREAM_AGENT_MODEL;
  delete process.env.AGENTBRANCH_MODEL_PROVIDER;
  delete process.env.AGENTBRANCH_PRO_PLAN_SLUG;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  Object.assign(process.env, env);
}
