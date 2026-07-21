import { describe, expect, it } from "vitest";
import { UserId, unwrap } from "@/shared";
import { createMemoryEquipmentRepository } from "./equipment.memory-repository";

describe("EquipmentRepository contract", () => {
  it("upserts by owner, kind, and name and enforces ownership", async () => {
    const repo = createMemoryEquipmentRepository();
    const userId = UserId("user-a");
    const first = await repo.save({ userId, kind: "response-schema", name: "Invoice", document: "{\"title\":\"Invoice\"}" });
    expect(first.ok).toBe(true);
    const second = await repo.save({ userId, kind: "response-schema", name: "Invoice", document: "{\"title\":\"Invoice\",\"type\":\"object\"}" });
    expect(second.ok && first.ok && second.value.id).toBe(first.ok && first.value.id);
    expect(unwrap(await repo.list(userId))).toHaveLength(1);
    expect(unwrap(await repo.get(first.ok ? first.value.id : "", UserId("other")))).toBeNull();
    await repo.remove(first.ok ? first.value.id : "", UserId("other"));
    expect(unwrap(await repo.list(userId))).toHaveLength(1);
  });
});
