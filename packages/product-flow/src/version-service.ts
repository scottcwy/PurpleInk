import { contentHash } from "./content-hash.ts";
import { validateFlowCapabilityProofs } from "./capabilities.ts";
import { parseProductFlowV1, ProductFlowValidationError } from "./validation.ts";
import type { ProductFlowVersionV1 } from "./schemas.ts";

export type ProductFlowVersionStatus = "draft" | "approved" | "rejected";

export type ProductFlowVersionRecord = {
  id: string;
  workspaceId: string;
  productFlowId: string;
  version: number;
  schemaVersion: "product-flow/v1";
  payload: ProductFlowVersionV1;
  contentHash: string;
  status: ProductFlowVersionStatus;
  approvedAt: string | null;
  createdAt: string;
};

type NewVersionRecord = Omit<ProductFlowVersionRecord, "version"> & { idempotencyKey: string };

export interface ProductFlowVersionRepository {
  createNext(record: NewVersionRecord): Promise<ProductFlowVersionRecord>;
  findById(id: string): Promise<ProductFlowVersionRecord | undefined>;
  list(productFlowId: string): Promise<ProductFlowVersionRecord[]>;
  approveDraft(id: string, approvedAt: string, idempotencyKey: string): Promise<ProductFlowVersionRecord>;
  replaceDraft(
    id: string,
    payload: ProductFlowVersionV1,
    hash: string,
    idempotencyKey: string,
  ): Promise<ProductFlowVersionRecord>;
  deleteDraft(id: string, idempotencyKey: string): Promise<void>;
}

export class ApprovedVersionImmutableError extends Error {
  constructor(versionId: string) {
    super(`Approved ProductFlowVersion is immutable: ${versionId}`);
    this.name = "ApprovedVersionImmutableError";
  }
}

export class ProductFlowVersionNotFoundError extends Error {
  constructor(versionId: string) {
    super(`ProductFlowVersion not found: ${versionId}`);
    this.name = "ProductFlowVersionNotFoundError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key was already used for a different mutation: ${key}`);
    this.name = "IdempotencyConflictError";
  }
}

export class CleanReplayRequiredError extends Error {
  constructor() {
    super("A clean replay must pass before approving a ProductFlowVersion");
    this.name = "CleanReplayRequiredError";
  }
}

export class CapabilityProofValidationError extends Error {
  readonly issueCodes: readonly string[];

  constructor(issueCodes: readonly string[]) {
    super(`ProductCapability proves validation failed: ${issueCodes.join(", ")}`);
    this.name = "CapabilityProofValidationError";
    this.issueCodes = issueCodes;
  }
}

export class ContentHashMismatchError extends Error {
  constructor(versionId: string) {
    super(`ProductFlowVersion content hash does not match its payload: ${versionId}`);
    this.name = "ContentHashMismatchError";
  }
}

const deepFreeze = <T>(input: T): T => {
  if (input !== null && typeof input === "object" && !Object.isFrozen(input)) {
    for (const value of Object.values(input)) deepFreeze(value);
    Object.freeze(input);
  }
  return input;
};

const copyRecord = (record: ProductFlowVersionRecord): ProductFlowVersionRecord =>
  deepFreeze(structuredClone(record));

type MutationResult =
  | { operation: "create" | "approve" | "replace"; fingerprint: string; recordId: string }
  | { operation: "delete"; fingerprint: string; recordId: string };

export class InMemoryProductFlowVersionRepository implements ProductFlowVersionRepository {
  readonly #records = new Map<string, ProductFlowVersionRecord>();
  readonly #mutations = new Map<string, MutationResult>();
  readonly #deletedMutations = new Set<string>();

  async createNext(record: NewVersionRecord): Promise<ProductFlowVersionRecord> {
    const mutationKey = `${record.workspaceId}:${record.idempotencyKey}`;
    const fingerprint = `create:${record.productFlowId}:${record.contentHash}`;
    const repeated = this.#mutations.get(mutationKey);
    if (repeated !== undefined) {
      if (repeated.operation !== "create" || repeated.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError(record.idempotencyKey);
      }
      return copyRecord(this.#require(repeated.recordId));
    }

    const version = Math.max(
      0,
      ...[...this.#records.values()]
        .filter((candidate) => candidate.productFlowId === record.productFlowId)
        .map((candidate) => candidate.version),
    ) + 1;
    const created: ProductFlowVersionRecord = structuredClone({
      id: record.id,
      workspaceId: record.workspaceId,
      productFlowId: record.productFlowId,
      version,
      schemaVersion: record.schemaVersion,
      payload: record.payload,
      contentHash: record.contentHash,
      status: record.status,
      approvedAt: record.approvedAt,
      createdAt: record.createdAt,
    });
    this.#records.set(created.id, created);
    this.#mutations.set(mutationKey, { operation: "create", fingerprint, recordId: created.id });
    return copyRecord(created);
  }

  async findById(id: string): Promise<ProductFlowVersionRecord | undefined> {
    const record = this.#records.get(id);
    return record === undefined ? undefined : copyRecord(record);
  }

  async list(productFlowId: string): Promise<ProductFlowVersionRecord[]> {
    return [...this.#records.values()]
      .filter((record) => record.productFlowId === productFlowId)
      .sort((left, right) => left.version - right.version)
      .map(copyRecord);
  }

  async approveDraft(id: string, approvedAt: string, idempotencyKey: string): Promise<ProductFlowVersionRecord> {
    const record = this.#require(id);
    const mutationKey = `${record.workspaceId}:${idempotencyKey}`;
    const fingerprint = `approve:${id}`;
    const repeated = this.#mutations.get(mutationKey);
    if (repeated !== undefined) {
      if (repeated.operation !== "approve" || repeated.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError(idempotencyKey);
      }
      return copyRecord(this.#require(repeated.recordId));
    }
    if (record.status === "approved") throw new ApprovedVersionImmutableError(id);
    const approved: ProductFlowVersionRecord = { ...record, status: "approved", approvedAt };
    this.#records.set(id, approved);
    this.#mutations.set(mutationKey, { operation: "approve", fingerprint, recordId: id });
    return copyRecord(approved);
  }

  async replaceDraft(
    id: string,
    payload: ProductFlowVersionV1,
    hash: string,
    idempotencyKey: string,
  ): Promise<ProductFlowVersionRecord> {
    const record = this.#require(id);
    if (record.status === "approved") throw new ApprovedVersionImmutableError(id);
    const mutationKey = `${record.workspaceId}:${idempotencyKey}`;
    const fingerprint = `replace:${id}:${hash}`;
    const repeated = this.#mutations.get(mutationKey);
    if (repeated !== undefined) {
      if (repeated.operation !== "replace" || repeated.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError(idempotencyKey);
      }
      return copyRecord(this.#require(repeated.recordId));
    }
    const replaced = { ...record, payload: structuredClone(payload), contentHash: hash };
    this.#records.set(id, replaced);
    this.#mutations.set(mutationKey, { operation: "replace", fingerprint, recordId: id });
    return copyRecord(replaced);
  }

  async deleteDraft(id: string, idempotencyKey: string): Promise<void> {
    const deletedMutationKey = `${id}:${idempotencyKey}`;
    if (this.#deletedMutations.has(deletedMutationKey)) return;
    const record = this.#require(id);
    if (record.status === "approved") throw new ApprovedVersionImmutableError(id);
    const mutationKey = `${record.workspaceId}:${idempotencyKey}`;
    const fingerprint = `delete:${id}`;
    const repeated = this.#mutations.get(mutationKey);
    if (repeated !== undefined) {
      if (repeated.operation !== "delete" || repeated.fingerprint !== fingerprint) {
        throw new IdempotencyConflictError(idempotencyKey);
      }
      return;
    }
    this.#records.delete(id);
    this.#mutations.set(mutationKey, { operation: "delete", fingerprint, recordId: id });
    this.#deletedMutations.add(deletedMutationKey);
  }

  #require(id: string): ProductFlowVersionRecord {
    const record = this.#records.get(id);
    if (record === undefined) throw new ProductFlowVersionNotFoundError(id);
    return record;
  }
}

export type ProductFlowVersionServiceDependencies = {
  now?: () => Date;
  newId?: () => string;
};

export class ProductFlowVersionService {
  readonly repository: ProductFlowVersionRepository;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(
    repository: ProductFlowVersionRepository,
    dependencies: ProductFlowVersionServiceDependencies = {},
  ) {
    this.repository = repository;
    this.#now = dependencies.now ?? (() => new Date());
    this.#newId = dependencies.newId ?? (() => globalThis.crypto.randomUUID());
  }

  async createVersion(input: {
    workspaceId: string;
    productFlowId: string;
    idempotencyKey: string;
    payload: unknown;
  }): Promise<ProductFlowVersionRecord> {
    const payload = parseProductFlowV1(input.payload);
    const hash = await contentHash(payload);
    return this.repository.createNext({
      id: this.#newId(),
      workspaceId: input.workspaceId,
      productFlowId: input.productFlowId,
      idempotencyKey: input.idempotencyKey,
      schemaVersion: payload.schemaVersion,
      payload,
      contentHash: hash,
      status: "draft",
      approvedAt: null,
      createdAt: this.#now().toISOString(),
    });
  }

  async approveVersion(input: {
    versionId: string;
    idempotencyKey: string;
    cleanReplayPassed: boolean;
    capabilities: readonly unknown[];
  }): Promise<ProductFlowVersionRecord> {
    if (!input.cleanReplayPassed) throw new CleanReplayRequiredError();
    const version = await this.getVersion(input.versionId);
    parseProductFlowV1(version.payload);
    const proofs = validateFlowCapabilityProofs(version.payload, input.capabilities);
    if (!proofs.success) {
      throw new CapabilityProofValidationError(proofs.issues.map((issue) => issue.code));
    }
    if ((await contentHash(version.payload)) !== version.contentHash) {
      throw new ContentHashMismatchError(version.id);
    }
    return this.repository.approveDraft(input.versionId, this.#now().toISOString(), input.idempotencyKey);
  }

  async replaceDraft(input: {
    versionId: string;
    idempotencyKey: string;
    payload: unknown;
  }): Promise<ProductFlowVersionRecord> {
    const payload = parseProductFlowV1(input.payload);
    const hash = await contentHash(payload);
    return this.repository.replaceDraft(input.versionId, payload, hash, input.idempotencyKey);
  }

  async deleteDraft(input: { versionId: string; idempotencyKey: string }): Promise<void> {
    return this.repository.deleteDraft(input.versionId, input.idempotencyKey);
  }

  async getVersion(versionId: string): Promise<ProductFlowVersionRecord> {
    const version = await this.repository.findById(versionId);
    if (version === undefined) throw new ProductFlowVersionNotFoundError(versionId);
    return version;
  }

  async listVersions(productFlowId: string): Promise<ProductFlowVersionRecord[]> {
    return this.repository.list(productFlowId);
  }
}

export { ProductFlowValidationError };
