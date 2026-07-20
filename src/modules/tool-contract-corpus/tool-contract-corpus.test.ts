import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { responseSchemaCorpus } from "@/modules/response-schema-corpus";
import {
  responseSchemaName,
  validateAgainstSchema,
} from "@/modules/response-schema";
import {
  parseToolContract,
  serializeToolContract,
  toolContractLintAnalyzer,
} from "@/modules/tool-contract";
import { resolveIoSchema } from "@/modules/test-run/contract-checks";
import { unwrap } from "@/shared";
import { toolContractBundleFixtures } from "./bundle-fixtures";
import { toolContractCorpus } from "./index";

describe("tool contract corpus", () => {
  it("ships eight curated, uniquely named contracts", () => {
    expect(toolContractCorpus).toHaveLength(8);
    expect(new Set(toolContractCorpus.map(({ id }) => id))).toHaveLength(8);
    expect(new Set(toolContractCorpus.map(({ name }) => name))).toHaveLength(8);
    expect(toolContractCorpus.some(({ name }) => name === "read_email")).toBe(
      true,
    );
  });

  it("round-trips every source and pins each content hash", () => {
    for (const entry of toolContractCorpus) {
      const serialized = serializeToolContract(entry.source);
      expect(unwrap(parseToolContract(serialized))).toEqual(entry.source);
      expect(entry.contentHash).toBe(
        createHash("sha256").update(serialized).digest("hex"),
      );
    }
    expect(
      Object.fromEntries(
        toolContractCorpus.map(({ id, contentHash }) => [id, contentHash]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "calculate-invoice": "d555a42648c376c217c5c682d77aac7062bd90b716a7e9f0e8d6000b74a11c40",
        "draft-customer-follow-up": "f5dee3c0e2b56c7771297b0fd0e2e9b5ce39989bfb26a9eb81df753ced710755",
        "extract-policy-obligations": "f3ec266aabe26832adfe11ab9d516b52762748a21cf73f70670c577974ab0445",
        "find-calendar-slots": "1fe7865f53abf8a578f2007387b068e9a29a36fb976ab0c94b045e578d7dbc48",
        "list-tasks-underspecified": "13a59a1fbaf0b5f618030d41ab65674faaea1f917822eb76e193b46c87fd8735",
        "read-email": "9d307d99cc1f458fd796b816a074301bab003b2161f0823236fcea94c2baa0e5",
        "record-receipt": "5edb812e2e8c891c2501c39ebd7d6ec0afd221152268c6761d62f879d1206cdd",
        "search-customer-records": "79745064c71d6f7081ad1063e0d5590daa8203c2c5c0ca2d456c306016f9402a",
      }
    `);
  });

  it("matches the frozen lint expectations", async () => {
    for (const entry of toolContractCorpus) {
      const report = unwrap(
        await toolContractLintAnalyzer.analyze(entry.source),
      );
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

  it("resolves every schema reference by curated title", () => {
    const schemas = responseSchemaCorpus.map(({ source }) => source);
    const titles = new Set(schemas.map(responseSchemaName));
    for (const { source } of toolContractCorpus) {
      for (const io of [source.input, source.output])
        if (io?.kind === "schema-ref")
          expect(titles.has(io.ref), `${source.name}: ${io.ref}`).toBe(true);
    }
  });

  it("keeps bundle outputs valid against their shared schemas", () => {
    expect(toolContractBundleFixtures.length).toBeGreaterThan(0);
    for (const fixture of toolContractBundleFixtures) {
      const schemas = fixture.schemas.map(({ source }) => source);
      for (const { source } of fixture.contracts) {
        const schema = resolveIoSchema(source.output, schemas);
        expect(schema, source.name).toBeDefined();
        for (const example of source.examples)
          if (example.output !== undefined)
            expect(
              validateAgainstSchema(example.output, schema!, "output"),
              source.name,
            ).toEqual([]);
      }
    }
  });
});
