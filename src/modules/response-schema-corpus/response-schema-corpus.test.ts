import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseResponseSchema,
  responseSchemaLintAnalyzer,
  serializeResponseSchema,
} from "@/modules/response-schema";
import { unwrap } from "@/shared";
import { responseSchemaCorpus } from "./index";

describe("response schema corpus", () => {
  it("ships eight curated, uniquely named schemas", () => {
    expect(responseSchemaCorpus).toHaveLength(8);
    expect(new Set(responseSchemaCorpus.map((entry) => entry.id))).toHaveLength(8);
    expect(new Set(responseSchemaCorpus.map((entry) => entry.name))).toHaveLength(8);
  });

  it("keeps every source parseable and losslessly serializable", () => {
    for (const entry of responseSchemaCorpus) {
      const serialized = serializeResponseSchema(entry.source);
      const parsed = unwrap(parseResponseSchema(serialized));

      expect(parsed).toEqual(entry.source);
      expect(serializeResponseSchema(parsed)).toBe(serialized);
      expect(entry.contentHash).toBe(createHash("sha256").update(serialized).digest("hex"));
    }
  });

  it("matches the frozen lint expectations", async () => {
    for (const entry of responseSchemaCorpus) {
      const report = unwrap(await responseSchemaLintAnalyzer.analyze(entry.source));
      expect(
        {
          grade: report.summary.grade,
          score: report.summary.score,
          findingCodes: report.summary.rules,
        },
        entry.id,
      ).toEqual(entry.expectedLint);
    }
  });

  it("pins the id-to-content-hash map", () => {
    expect(Object.fromEntries(responseSchemaCorpus.map(({ id, contentHash }) => [id, contentHash])))
      .toMatchInlineSnapshot(`
        {
          "calendar-week-plan": "021cf39e20ffdd693db5c71ae7fdcd323d45ae59a25bd517e18f6ef650f6a419",
          "content-plan-undescribed": "181d0e90613a7210697606a9507d0434afbdfe0e1fbae0d6d843cf1490229a72",
          "customer-follow-up-open": "6796af69e32fa38ac043816c159b25c793c203f9837624965c55530d9476e3cf",
          "email-triage-decision": "ace4cf8862eb32d2e060c6f3309e68360935443de7c73434419840a8ad09ee35",
          "invoice-line-items": "cb150ed70c02085b52d63e9242ba269bcf79eba571b4347998d7297851b94dff",
          "policy-obligations": "3199ea9039dc0f26297ac7f1ecdf5e93ab73552a345c777e769a926ab84ccbce",
          "receipt-record-optional": "a294ce744f45b1d5520c98711666abd60e87951ac7649d13cb1041dbe82e3d14",
          "support-answer-unbounded": "970825ab646c76c6c994eab8ee63e244c993f542ba1b3667def5cfd97fb08c86",
        }
      `);
  });
});
