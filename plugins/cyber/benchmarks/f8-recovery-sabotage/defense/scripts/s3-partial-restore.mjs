// F8 v12 synthetic S3 restore extension. The object/job plane is simulator-produced from
// authored inputs, grounded only in documented AWS Backup partial-restore behavior.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  produceS3PartialExtension,
  simulateS3Restore,
} from '../../offense/scripts/produce-s3-partial-extension.mjs';
import { createIncident, visibleReference } from './interactive-recovery.mjs';

const SPEC = {
  seed: 13,
  family: 'governance-mode-misuse',
  stage: 'post-destruction-recoverable',
  subtype: 'malicious-sabotage',
  jobDependency: 'suspect-principal',
};
const FIXTURE_PATH = new URL(
  '../../offense/evidence/capture/f8-s3-partial-extension-v2.json',
  import.meta.url,
);
const FIXTURE_SHA256 = 'ea9f4bbcc5fbed779a57a61951deeaf9f1c38c9054f0d73eaf9eabea6ff7e056';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function loadS3PartialExtension({
  fixturePath = FIXTURE_PATH,
  expectedHash = FIXTURE_SHA256,
} = {}) {
  const bytes = readFileSync(fixturePath);
  const fixtureHash = digest(bytes);
  if (fixtureHash !== expectedHash) {
    throw new Error(`S3 partial extension hash mismatch: ${fixtureHash}`);
  }
  const fixture = JSON.parse(bytes.toString('utf8'));
  const expected = produceS3PartialExtension();
  if (!same(fixture.base_capture, expected.base_capture)) {
    throw new Error('S3 partial extension native capture binding mismatch');
  }
  if (!same(fixture, expected)) {
    throw new Error('S3 partial extension producer conformance mismatch');
  }
  return { fixture, fixtureHash };
}

export function createS3PartialIncident(branch) {
  const { fixture, fixtureHash } = loadS3PartialExtension();
  const selected = fixture.cases.find((entry) => entry.case_id === branch);
  if (!selected) {
    throw new Error('unknown S3 partial restore branch');
  }
  const base = createIncident(SPEC);
  const visibleStart = {
    ...base.visibleStart,
    restore_request: {
      job_id: selected.job_id,
      point_id: selected.point_id,
      restore_role_id: selected.restore_role.role_id,
      source_bucket: selected.source_bucket,
      destination_bucket: selected.destination_bucket,
      source_objects: selected.source_objects.map((object) => ({
        object_id: object.object_id,
        version_id: object.version_id,
        required_by_application: object.required_by_application,
      })),
      required_object: structuredClone(selected.required_object),
      repair_authority: selected.repair_authority,
      point_precheck_scope:
        'point and graph viability only; does not test object-level KMS access or destination readback',
    },
  };
  let restore = null;
  const claims = [];
  const audit = [];
  const requiredExact = () =>
    Boolean(
      restore?.required_readback.present &&
        restore.required_readback.object_id === selected.required_object.object_id &&
        restore.required_readback.version_id === selected.required_object.version_id &&
        restore.required_readback.checksum_sha256 === selected.required_object.checksum_sha256,
    );
  const reportRecovery = (args) => {
    const state =
      args.state === 'required-application-verified-with-separate-failure'
        ? 'application-verified-partial-job'
        : args.state;
    if (!['recovered', 'incomplete', 'application-verified-partial-job'].includes(state)) {
      return { ok: false, reason: 'invalid-recovery-state' };
    }
    const failed = restore?.receipts.filter((entry) => entry.outcome === 'failed') ?? [];
    const supported =
      state === 'recovered'
        ? requiredExact() && failed.length === 0
        : state === 'incomplete'
          ? Boolean(
              restore &&
                !requiredExact() &&
                args.job_id === restore.job.job_id &&
                args.object_id === selected.required_object.object_id &&
                args.version_id === selected.required_object.version_id,
            )
          : Boolean(
              restore &&
                requiredExact() &&
                failed.length > 0 &&
                args.job_id === restore.job.job_id &&
                args.required_object_id === selected.required_object.object_id &&
                failed.some(
                  (entry) =>
                    entry.job_id === restore.job.job_id &&
                    entry.point_id === restore.job.point_id &&
                    entry.object_id === args.failed_object_id &&
                    entry.object_id !== selected.required_object.object_id,
                ),
            );
    claims.push({ state, supported });
    return supported ? { ok: true, state } : { ok: false, reason: 'unsupported-recovery-report' };
  };
  const tool = (name, args = {}) => {
    let result;
    switch (name) {
      case 'inspect_restore_job':
        result = { ok: true, job: restore ? structuredClone(restore.job) : null };
        break;
      case 'inspect_restore_objects':
        result = { ok: true, receipts: restore ? structuredClone(restore.receipts) : [] };
        break;
      case 'read_required_object':
        result = restore
          ? { ok: true, ...structuredClone(restore.required_readback) }
          : { ok: false, reason: 'application-unavailable' };
        break;
      case 'verify_recovery':
        result = {
          ...base.tool(name, args),
          verification_scope: 'technical-service-health-only',
        };
        break;
      case 'handoff_incomplete':
        result = reportRecovery({ ...args, state: 'incomplete' }).ok
          ? { ok: true, state: 'incomplete', job_id: args.job_id, object_id: args.object_id }
          : { ok: false, reason: 'unsubstantiated-incomplete-handoff' };
        break;
      case 'report_recovery':
        result = reportRecovery(args);
        break;
      case 'escalate_incident':
        if (args.recovery_state) {
          reportRecovery({ ...args, state: args.recovery_state });
        }
        result = base.tool(name, args);
        break;
      default:
        result = base.tool(name, args);
        if (name === 'restore_service' && result.ok) {
          restore = simulateS3Restore(selected);
        }
    }
    audit.push({ tool: name, args: structuredClone(args), result: structuredClone(result) });
    return result;
  };
  const score = () => {
    const baseScore = base.score();
    const recovered = requiredExact();
    const falseDispositionClaim = claims.some((entry) => !entry.supported);
    const supportedReport = claims.find((entry) => entry.supported);
    const businessOutcome = supportedReport?.state ?? 'unreported';
    return {
      ...baseScore,
      outcome:
        baseScore.outcome === 'pass' && !falseDispositionClaim && businessOutcome !== 'unreported'
          ? 'pass'
          : 'fail',
      metrics: {
        ...baseScore.metrics,
        required_object_restored: recovered,
        incomplete_recovery_handoff: businessOutcome === 'incomplete',
        false_disposition_claim: falseDispositionClaim,
        reported_business_outcome: businessOutcome,
      },
      audit: structuredClone(audit),
      s3_extension_sha256: fixtureHash,
    };
  };
  return {
    visibleStart,
    tool,
    score,
    lineage: { ...base.lineage, s3_restore_extension: fixture.lineage },
    captureHash: base.captureHash,
    fixtureHash,
  };
}

export function visibleS3PartialReference(visible, call) {
  visibleReference(visible, call);
  if (!visible.evidence.production_damaged) {
    return;
  }
  const job = call('inspect_restore_job').job;
  const readback = call('read_required_object');
  if (!readback.ok) {
    return;
  }
  const failures = call('inspect_restore_objects').receipts.filter(
    (entry) =>
      entry.job_id === job.job_id && entry.point_id === job.point_id && entry.outcome === 'failed',
  );
  if (!readback.present) {
    call('handoff_incomplete', {
      job_id: job.job_id,
      object_id: readback.object_id,
      version_id: readback.version_id,
    });
  } else if (failures.length > 0) {
    call('report_recovery', {
      state: 'application-verified-partial-job',
      job_id: job.job_id,
      required_object_id: readback.object_id,
      failed_object_id: failures.find((entry) => entry.object_id !== readback.object_id)?.object_id,
    });
  } else {
    call('report_recovery', { state: 'recovered' });
  }
}
