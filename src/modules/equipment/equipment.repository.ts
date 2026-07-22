import type { DomainError, Result, UserId } from "@/shared";

export const EQUIPMENT_COUNT_MAX = 50;
export const EQUIPMENT_CAP_MESSAGE =
  "You're at your equipment limit - remove a saved document to make room.";

export type EquipmentKind = "response-schema" | "tool-contract" | "subagent-definition";

export type Equipment = {
  readonly id: string;
  readonly userId: UserId;
  readonly kind: EquipmentKind;
  readonly name: string;
  readonly document: string;
  readonly contentHash: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type SaveEquipmentInput = Pick<Equipment, "userId" | "kind" | "name" | "document">;

export interface EquipmentRepository {
  save(input: SaveEquipmentInput): Promise<Result<Equipment, DomainError>>;
  list(userId: UserId): Promise<Result<readonly Equipment[], DomainError>>;
  get(id: string, userId: UserId): Promise<Result<Equipment | null, DomainError>>;
  remove(id: string, userId: UserId): Promise<Result<void, DomainError>>;
}
