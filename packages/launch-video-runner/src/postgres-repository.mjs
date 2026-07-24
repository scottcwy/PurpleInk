import { randomUUID } from "node:crypto";

import {
  IdempotencyConflictError,
  RunnerContractError,
  StaleAttemptError,
} from "./runner.mjs";

export class PostgresLaunchVideoJobRepository {
  constructor(sql) {
    this.sql = sql;
  }

  async get(jobId, workspaceId) {
    const rows = await this.sql`
      select * from launch_video_jobs
      where workspace_id=${workspaceId} and id=${jobId}
    `;
    return rows[0];
  }

  async receipt(workspaceId, key) {
    const rows = await this.sql`
      select fingerprint,result from render_job_receipts
      where workspace_id=${workspaceId} and idempotency_key=${key}
    `;
    return rows[0];
  }

  async begin({ jobId, workspaceId, releaseId, attempt, skillInput, inputFingerprint }) {
    return this.sql.begin(async (tx) => {
      const jobs = await tx`
        select * from launch_video_jobs
        where workspace_id=${workspaceId} and id=${jobId}
        for update
      `;
      const existing = jobs[0];
      if (existing) {
        if (existing.input_fingerprint !== inputFingerprint) {
          throw new RunnerContractError(["retry changed the immutable skill input"]);
        }
        if (attempt <= existing.current_attempt) {
          throw new StaleAttemptError(jobId, attempt, existing.current_attempt);
        }
        if (existing.status !== "failed") {
          throw new RunnerContractError(["retry requires a failed launch video job"]);
        }
        const releases = await tx`
          select id from releases
          where workspace_id=${workspaceId} and id=${releaseId}
            and lifecycle='active' and stage='preview_queued'
            and storyboard_version_id=${existing.storyboard_version_id}
            and evidence_package_version_id=${existing.evidence_package_version_id}
            and brand_kit_version_id=${existing.brand_kit_version_id}
          for update
        `;
        if (!releases[0]) {
          throw new RunnerContractError(["Release pins changed before launch video retry"]);
        }
        await tx`
          update launch_video_jobs set current_attempt=${attempt},status='running',
            error_code=null,updated_at=now()
          where workspace_id=${workspaceId} and id=${jobId}
        `;
        await tx`
          update releases set stage='preview_rendering',revision=revision+1,updated_at=now()
          where workspace_id=${workspaceId} and id=${releaseId}
            and lifecycle='active' and stage='preview_queued'
        `;
        return { ...existing, currentAttempt: attempt, status: "running" };
      }

      const releases = await tx`
        select * from releases
        where workspace_id=${workspaceId} and id=${releaseId}
        for update
      `;
      const release = releases[0];
      if (
        !release || release.lifecycle !== "active" || release.stage !== "preview_queued" ||
        release.storyboard_version_id !== skillInput.storyboardVersionId ||
        release.evidence_package_version_id !== skillInput.evidencePackageVersionId ||
        release.brand_kit_version_id !== skillInput.brandKitVersionId
      ) {
        throw new RunnerContractError(["Release is not preview-queued with the requested pinned inputs"]);
      }
      await tx`
        insert into launch_video_jobs(
          id,workspace_id,release_id,storyboard_version_id,evidence_package_version_id,
          brand_kit_version_id,locale,template_version,status,current_attempt
          ,input_fingerprint
        ) values(
          ${jobId},${workspaceId},${releaseId},${skillInput.storyboardVersionId},
          ${skillInput.evidencePackageVersionId},${skillInput.brandKitVersionId},
          ${skillInput.locale},${skillInput.templateVersion},'running',${attempt},
          ${inputFingerprint}
        )
      `;
      await tx`
        update releases set stage='preview_rendering',revision=revision+1,updated_at=now()
        where workspace_id=${workspaceId} and id=${releaseId}
      `;
      return { jobId, workspaceId, releaseId, currentAttempt: attempt, status: "running" };
    });
  }

  async fail(jobId, attempt, error, workspaceId) {
    await this.sql.begin(async (tx) => {
      const jobs = await tx`
        select release_id,current_attempt from launch_video_jobs
        where workspace_id=${workspaceId} and id=${jobId} for update
      `;
      const job = jobs[0];
      if (!job) throw new RunnerContractError([`unknown job ${jobId}`]);
      if (job.current_attempt !== attempt) throw new StaleAttemptError(jobId, attempt, job.current_attempt);
      await tx`
        update launch_video_jobs set status='failed',error_code='RENDER_FAILED',updated_at=now()
        where workspace_id=${workspaceId} and id=${jobId}
      `;
      await tx`
        update releases set stage='preview_queued',revision=revision+1,updated_at=now()
        where workspace_id=${workspaceId} and id=${job.release_id} and stage='preview_rendering'
      `;
      await tx`
        insert into audit_events(workspace_id,actor_type,event_type,subject_type,subject_id,payload)
        select workspace_id,'system','launch_video.failed','launch_video_job',id,
          ${tx.json({ attempt, error })}
        from launch_video_jobs where workspace_id=${workspaceId} and id=${jobId}
      `;
    });
  }

  async publish(jobId, attempt, publication) {
    return this.sql.begin(async (tx) => {
      const jobs = await tx`
        select * from launch_video_jobs
        where workspace_id=${publication.workspaceId} and id=${jobId} for update
      `;
      const job = jobs[0];
      if (!job) throw new RunnerContractError([`unknown job ${jobId}`]);
      if (job.current_attempt !== attempt) throw new StaleAttemptError(jobId, attempt, job.current_attempt);
      if (job.status !== "running") throw new RunnerContractError(["current attempt is not running"]);

      const planId = randomUUID();
      const bundleId = randomUUID();
      const renderJobId = randomUUID();
      const renderAttemptId = randomUUID();
      const artifactId = randomUUID();
      const planHash = publication.bundle.manifest.inputHashes.plan;
      const qualityReportKey = `${publication.prefix}/artifacts/quality-report.json`;
      await tx`
        insert into launch_video_plans(
          id,workspace_id,launch_video_job_id,attempt,release_id,storyboard_version_id,
          evidence_package_version_id,brand_kit_version_id,locale,payload,plan_hash
        ) values(
          ${planId},${job.workspace_id},${jobId},${attempt},${job.release_id},
          ${job.storyboard_version_id},${job.evidence_package_version_id},
          ${job.brand_kit_version_id},${job.locale},${tx.json(publication.plan)},${planHash}
        )
      `;
      await tx`
        insert into composition_bundles(
          id,workspace_id,release_id,storyboard_version_id,evidence_package_version_id,
          brand_kit_version_id,locale,launch_video_job_id,launch_video_plan_id,
          quality_report_r2_key,plan_hash,bundle_hash,r2_key,status
        ) values(
          ${bundleId},${job.workspace_id},${job.release_id},${job.storyboard_version_id},
          ${job.evidence_package_version_id},${job.brand_kit_version_id},${job.locale},
          ${jobId},${planId},${qualityReportKey},${planHash},${publication.bundleHash},
          ${publication.prefix},'quality_passed'
        )
      `;
      await tx`
        insert into render_jobs(
          id,workspace_id,release_id,bundle_id,launch_video_job_id,kind,status,
          render_key,requested_outputs,current_attempt
        ) values(
          ${renderJobId},${job.workspace_id},${job.release_id},${bundleId},${jobId},
          'preview','succeeded',${`${publication.bundleHash}:landscape:preview`},
          ${tx.json([{ variantId: "landscape", quality: "preview" }])},${attempt}
        )
      `;
      await tx`
        insert into render_attempts(id,workspace_id,render_job_id,attempt,status,finished_at)
        values(${renderAttemptId},${job.workspace_id},${renderJobId},${attempt},'succeeded',now())
      `;
      const variant = publication.bundle.manifest.variants.find(({ id }) => id === "landscape");
      await tx`
        insert into artifacts(
          id,workspace_id,render_job_id,attempt_id,kind,r2_key,sha256,bytes,mime_type,
          metadata,published_at
        ) values(
          ${artifactId},${job.workspace_id},${renderJobId},${renderAttemptId},'preview_landscape',
          ${publication.preview.r2Key},${publication.preview.sha256},${publication.preview.bytes},
          ${publication.preview.mimeType},${tx.json({
            bundleHash: publication.bundleHash,
            planHash,
            width: variant?.width,
            height: variant?.height,
            durationMs: publication.bundle.manifest.durationMs,
            qualityReportKey,
          })},now()
        )
      `;
      await tx`
        update launch_video_jobs set status='succeeded',error_code=null,updated_at=now()
        where workspace_id=${job.workspace_id} and id=${jobId}
      `;
      const releases = await tx`
        update releases set preview_bundle_id=${bundleId},stage='preview_review',
          revision=revision+1,updated_at=now()
        where workspace_id=${job.workspace_id} and id=${job.release_id}
          and lifecycle='active' and stage='preview_rendering'
          and storyboard_version_id=${job.storyboard_version_id}
          and evidence_package_version_id=${job.evidence_package_version_id}
          and brand_kit_version_id=${job.brand_kit_version_id}
        returning id
      `;
      if (!releases[0]) throw new RunnerContractError(["Release pins changed before publication"]);
      if (publication.receipt) {
        await tx`
          insert into render_job_receipts(
            workspace_id,launch_video_job_id,idempotency_key,fingerprint,result
          ) values(
            ${job.workspace_id},${jobId},${publication.receipt.key},
            ${publication.receipt.fingerprint},${tx.json(publication.receipt.result)}
          )
        `;
      }
      return { bundleId, renderJobId, renderAttemptId, artifactId };
    });
  }
}
