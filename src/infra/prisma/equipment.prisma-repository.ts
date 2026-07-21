import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  EQUIPMENT_CAP_MESSAGE,
  EQUIPMENT_COUNT_MAX,
  type Equipment,
  type EquipmentRepository,
} from "@/modules/equipment";
import { UserId, domainError, ok } from "@/shared";

export function createPrismaEquipmentRepository(prisma: PrismaClient): EquipmentRepository {
  const map = (row: Awaited<ReturnType<typeof prisma.equipment.findFirst>>): Equipment | null => row && ({
    id: row.id,
    userId: UserId(row.userId),
    kind: row.kind as Equipment["kind"],
    name: row.name,
    document: row.document,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return {
    async save(input) {
      const existing = await prisma.equipment.findUnique({ where: { userId_kind_name: { userId: input.userId, kind: input.kind, name: input.name } } });
      if (!existing && await prisma.equipment.count({ where: { userId: input.userId } }) >= EQUIPMENT_COUNT_MAX) {
        return { ok: false, error: domainError("cap_reached", EQUIPMENT_CAP_MESSAGE) };
      }
      const row = await prisma.equipment.upsert({
        where: { userId_kind_name: { userId: input.userId, kind: input.kind, name: input.name } },
        create: { ...input, contentHash: createHash("sha256").update(input.document).digest("hex") },
        update: { document: input.document, contentHash: createHash("sha256").update(input.document).digest("hex") },
      });
      return ok(map(row)!);
    },
    async list(userId) { return ok((await prisma.equipment.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } })).map((row) => map(row)!)); },
    async get(id, userId) { return ok(map(await prisma.equipment.findFirst({ where: { id, userId } }))); },
    async remove(id, userId) { await prisma.equipment.deleteMany({ where: { id, userId } }); return ok(undefined); },
  };
}
