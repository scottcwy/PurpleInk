import { compile, OUTPUT_VARIANTS_V1 } from "@purpleink/video-compiler";
import {
  planErrors,
  provenanceErrors,
  validateSchema,
} from "../../../skills/product-launch-video/scripts/validation-lib.mjs";

const clone = (value) => structuredClone(value);

export class RunnerContractError extends Error {
  constructor(errors) {
    super(`LaunchVideoRunner contract rejected: ${errors.join("; ")}`);
    this.name = "RunnerContractError";
    this.errors = errors;
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key) {
    super(`Idempotency key was already used for another launch video request: ${key}`);
    this.name = "IdempotencyConflictError";
  }
}

export class StaleAttemptError extends Error {
  constructor(jobId, attempt, currentAttempt) {
    super(`Attempt ${attempt} for ${jobId} is stale; current attempt is ${currentAttempt}`);
    this.name = "StaleAttemptError";
  }
}

function fingerprint(request) {
  return JSON.stringify({
    jobId: request.jobId,
    attempt: request.attempt,
    workspaceId: request.workspaceId,
    skillInput: request.skillInput,
  });
}

function contentType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

export class InMemoryRunnerObjectStore {
  objects = new Map();
  metadata = new Map();

  async put(key, bytes, metadata = {}) {
    this.objects.set(key, Buffer.from(bytes));
    this.metadata.set(key, clone(metadata));
  }

  async get(key) {
    const value = this.objects.get(key);
    return value ? Buffer.from(value) : null;
  }
}

export class InMemoryLaunchVideoJobRepository {
  #jobs = new Map();
  #receipts = new Map();

  get(jobId) {
    const job = this.#jobs.get(jobId);
    return job ? clone(job) : undefined;
  }

  receipt(workspaceId, key) {
    const value = this.#receipts.get(`${workspaceId}:${key}`);
    return value ? clone(value) : undefined;
  }

  saveReceipt(workspaceId, key, value) {
    this.#receipts.set(`${workspaceId}:${key}`, clone(value));
  }

  begin({ jobId, workspaceId, releaseId, attempt }) {
    const existing = this.#jobs.get(jobId);
    if (existing && existing.workspaceId !== workspaceId) {
      throw new RunnerContractError(["job belongs to another workspace"]);
    }
    if (existing && attempt < existing.currentAttempt) {
      throw new StaleAttemptError(jobId, attempt, existing.currentAttempt);
    }
    if (existing && attempt === existing.currentAttempt && existing.status === "running") {
      throw new RunnerContractError(["attempt is already running"]);
    }
    const job = {
      jobId,
      workspaceId,
      releaseId,
      currentAttempt: attempt,
      status: "running",
      publishedAttempt: existing?.publishedAttempt,
      publishedBundleHash: existing?.publishedBundleHash,
      error: undefined,
    };
    this.#jobs.set(jobId, job);
    return clone(job);
  }

  fail(jobId, attempt, error) {
    const job = this.#requireCurrent(jobId, attempt);
    job.status = "failed";
    job.error = error;
  }

  publish(jobId, attempt, bundleHash) {
    const job = this.#requireCurrent(jobId, attempt);
    job.status = "succeeded";
    job.publishedAttempt = attempt;
    job.publishedBundleHash = bundleHash;
    job.error = undefined;
  }

  #requireCurrent(jobId, attempt) {
    const job = this.#jobs.get(jobId);
    if (!job) throw new RunnerContractError([`unknown job ${jobId}`]);
    if (job.currentAttempt !== attempt) {
      throw new StaleAttemptError(jobId, attempt, job.currentAttempt);
    }
    return job;
  }
}

export class LaunchVideoRunner {
  constructor({ repository, objectStore, direct, qualityGate, compiler = compile }) {
    this.repository = repository;
    this.objectStore = objectStore;
    this.direct = direct;
    this.qualityGate = qualityGate;
    this.compiler = compiler;
  }

  async run(request) {
    const errors = await this.#inputErrors(request);
    if (errors.length) throw new RunnerContractError(errors);
    const requestFingerprint = fingerprint(request);
    const receipt = this.repository.receipt(request.workspaceId, request.idempotencyKey);
    if (receipt) {
      if (receipt.fingerprint !== requestFingerprint) {
        throw new IdempotencyConflictError(request.idempotencyKey);
      }
      return clone(receipt.result);
    }
    this.repository.begin({
      jobId: request.jobId,
      workspaceId: request.workspaceId,
      releaseId: request.skillInput.releaseId,
      attempt: request.attempt,
    });
    try {
      const plan = await this.direct(clone(request.skillInput));
      const planValidation = [
        ...(await validateSchema(plan, "launch-video-plan-v1.schema.json")),
        ...planErrors(plan, request.skillInput),
      ];
      if (planValidation.length) throw new RunnerContractError(planValidation);
      const bundle = this.compiler({
        plan,
        brandKit: request.skillInput.brandKit,
        assetPackage: request.skillInput.evidencePackage,
        templateVersion: request.skillInput.templateVersion,
        outputVariants: OUTPUT_VARIANTS_V1,
        compilerVersion: "video-compiler@0.1.0",
        hyperframesVersion: "0.7.68",
      });
      const prefix = `workspaces/${request.workspaceId}/release-jobs/${request.jobId}/attempt-${request.attempt}/${bundle.bundleHash}`;
      for (const [path, file] of Object.entries(bundle.files)) {
        const bytes = file.encoding === "base64" ? Buffer.from(file.content, "base64") : Buffer.from(file.content);
        await this.objectStore.put(`${prefix}/${path}`, bytes, {
          contentType: contentType(path),
          bundleHash: bundle.bundleHash,
        });
      }
      const qualityReport = await this.qualityGate({ bundle, prefix, workspaceId: request.workspaceId });
      if (qualityReport.bundleHash !== bundle.bundleHash) {
        throw new RunnerContractError(["quality report bundle hash mismatch"]);
      }
      await this.publishCallback({ jobId: request.jobId, attempt: request.attempt, bundleHash: bundle.bundleHash });
      const result = {
        status: "succeeded",
        bundle,
        qualityReport,
        preview: { variantId: "landscape", r2Key: `${prefix}/variants/landscape/index.html` },
      };
      this.repository.saveReceipt(request.workspaceId, request.idempotencyKey, {
        fingerprint: requestFingerprint,
        result,
      });
      return clone(result);
    } catch (error) {
      this.repository.fail(request.jobId, request.attempt, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  async publishCallback({ jobId, attempt, bundleHash }) {
    this.repository.publish(jobId, attempt, bundleHash);
  }

  async #inputErrors(request) {
    const errors = [];
    if (!request.idempotencyKey) errors.push("idempotencyKey is required");
    if (!Number.isInteger(request.attempt) || request.attempt < 1) errors.push("attempt must be a positive integer");
    if (request.skillInput?.workspaceId !== request.workspaceId) errors.push("skillInput.workspaceId must equal job workspaceId");
    errors.push(...(await validateSchema(request.skillInput, "input-v1.schema.json")));
    errors.push(...provenanceErrors(request.skillInput));
    return errors;
  }
}
