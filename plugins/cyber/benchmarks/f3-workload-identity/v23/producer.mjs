import { sha256Hex } from '../shared/estate.mjs';
import { projectVisible } from '../v20/producer.mjs';
import { buildNativeEpisode } from '../v21/producer.mjs';
import { resolveCurrentApprovals } from './ledger.mjs';

function published(record) {
  const { available_at: _availableAt, ...rest } = record;
  return rest;
}

export function buildEpisode(spec) {
  const raw = buildNativeEpisode(spec, { requirePersistentJobDenial: true });
  const compact = projectVisible(raw, { minJobs: 5, maxJobs: 6 });
  const { current_job_approvals: _currentJobApprovals, ...visible } = compact;
  const streams = new Set(
    visible.events
      .filter((event) => event.kind === 'job-admission' && event.outcome === 'admitted')
      .flatMap((event) => [event.approval_stream_ref, event.owner_approval_stream_ref]),
  );
  const journal = {
    ...visible,
    approval_snapshots: raw.visible.grant_snapshots
      .filter((snapshot) => streams.has(snapshot.approval_stream_ref))
      .map(published),
    approval_publications: raw.visible.approval_publications
      .filter((publication) => streams.has(publication.approval_stream_ref))
      .map(published),
  };
  const current = resolveCurrentApprovals(journal);
  const pairSeed = spec.seed - (spec.seed % 2);
  const batchRef = `change-set-${sha256Hex(`${pairSeed}|${spec.family}|grant-sync`).slice(0, 20)}`;
  const policy = journal.policy_snapshots.find(
    (item) => item.kind === 'runtime-read-policy',
  )?.policy;
  if (!policy || !Array.isArray(policy.resources) || !Array.isArray(policy.actions)) {
    throw new Error('bulk grant proposal needs the published runtime policy');
  }
  const firstArrival =
    Math.max(
      ...journal.events.map((item) => item.arrival_order),
      ...journal.approval_publications.map((item) => item.arrival_order),
    ) + 1;
  const failedRetries = current.map((approval, index) => {
    const submission = journal.events.find(
      (item) => item.kind === 'job-submitted' && item.job_uid === approval.job_uid,
    );
    if (!submission) {
      throw new Error('bulk grant proposal needs the published Job submission');
    }
    const staleRef =
      approval.lane === 'change' ? submission.grant_snapshot_ref : submission.owner_snapshot_ref;
    if (staleRef === approval.snapshot_ref) {
      throw new Error('bulk grant proposal requires a superseded base snapshot');
    }
    const snapshotRef = `approvalsnap-${sha256Hex(`${batchRef}|${approval.approval_stream_ref}`).slice(0, 20)}`;
    const proposals = policy.resources.flatMap((resource) =>
      policy.actions.map((action) => ({
        grant_id: `jobgrant-${sha256Hex(`${snapshotRef}|${resource}|${action}`).slice(0, 20)}`,
        writer_principal: submission.actor,
        task: { action, remote_ref: resource },
        scope: {
          service_account_id: submission.service_account_id,
          template_id: submission.template_id,
          valid_from: policy.valid_from,
          valid_until: policy.valid_until,
        },
      })),
    );
    const proposalSnapshot = {
      snapshot_ref: snapshotRef,
      approval_stream_ref: approval.approval_stream_ref,
      audit_stream_ref: approval.audit_stream_ref,
      grants: proposals,
    };
    journal.approval_snapshots.push(proposalSnapshot);
    raw.native.grant_snapshots.push({
      ...structuredClone(proposalSnapshot),
      available_at: journal.triage_time,
    });
    return {
      event_id: `evt-${sha256Hex(`${batchRef}|${approval.approval_stream_ref}`).slice(0, 24)}`,
      kind: 'approval-snapshot-revision',
      approval_stream_ref: approval.approval_stream_ref,
      previous_snapshot_ref: staleRef,
      new_snapshot_ref: snapshotRef,
      event_time: journal.triage_time,
      arrival_order: firstArrival + index,
      outcome: 'failed',
      failure_reason: 'stale-predecessor',
      batch_ref: batchRef,
    };
  });
  journal.approval_publications.push(...failedRetries);
  raw.native.approval_publications.push(
    ...failedRetries.map((item) => ({
      ...structuredClone(item),
      available_at: journal.triage_time,
    })),
  );
  return { native: raw.native, visible: journal };
}
