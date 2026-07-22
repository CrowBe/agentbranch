import { createHash, randomUUID } from "node:crypto";
import {
  EQUIPMENT_CAP_MESSAGE,
  EQUIPMENT_COUNT_MAX,
  type Equipment,
  type EquipmentRepository,
} from "@/modules/equipment";
import { domainError, ok } from "@/shared";

export function createMemoryEquipmentRepository(): EquipmentRepository {
  const records = new Map<string, Equipment>();

  return {
    async save(input) {
      const existing = [...records.values()].find(
        (item) => item.userId === input.userId && item.kind === input.kind && item.name === input.name,
      );
      if (!existing && [...records.values()].filter((item) => item.userId === input.userId).length >= EQUIPMENT_COUNT_MAX) {
        return { ok: false, error: domainError("cap_reached", EQUIPMENT_CAP_MESSAGE) };
      }
      const now = new Date();
      const equipment: Equipment = {
        id: existing?.id ?? randomUUID(),
        ...input,
        contentHash: createHash("sha256").update(input.document).digest("hex"),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      records.set(equipment.id, equipment);
      return ok(equipment);
    },
    async list(userId) {
      return ok([...records.values()].filter((item) => item.userId === userId).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
    },
    async get(id, userId) {
      const item = records.get(id);
      return ok(item?.userId === userId ? item : null);
    },
    async remove(id, userId) {
      const item = records.get(id);
      if (item?.userId === userId) records.delete(id);
      return ok(undefined);
    },
  };
}
