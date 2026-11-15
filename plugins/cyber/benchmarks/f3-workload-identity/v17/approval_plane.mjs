// Defense-side organizational approval audit. This producer is intentionally
// independent of the model-visible rule interpreter.
import { sha256Hex } from '../shared/estate.mjs';

function requiredString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a nonempty string`);
  }
  return value;
}

function requiredTime(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative safe integer`);
  }
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function opaque(prefix, streamRef, ordinal) {
  return `${prefix}-${sha256Hex(['f3-v17-approval', streamRef, ordinal].join('|')).slice(0, 16)}`;
}

export function deriveApprovalStreamRef({ seed, family, recordRef }) {
  requiredTime(seed, 'seed');
  requiredString(family, 'family');
  requiredString(recordRef, 'recordRef');
  return `approvalstream-${sha256Hex(['f3-v17-approval-stream', seed, family, recordRef].join('|')).slice(0, 16)}`;
}

function snapshot(ref, streamRef, auditStreamRef, grants) {
  if (!Array.isArray(grants)) {
    throw new Error('approval grants must be an array');
  }
  return deepFreeze({
    snapshot_ref: ref,
    approval_stream_ref: streamRef,
    audit_stream_ref: auditStreamRef,
    grants: structuredClone(grants),
  });
}

export function createApprovalStream({
  seed,
  family,
  recordRef,
  baseSnapshotRef,
  grants,
  auditStreamRef,
}) {
  requiredString(baseSnapshotRef, 'baseSnapshotRef');
  requiredString(auditStreamRef, 'auditStreamRef');
  const streamRef = deriveApprovalStreamRef({ seed, family, recordRef });
  return {
    approval_stream_ref: streamRef,
    snapshots: [snapshot(baseSnapshotRef, streamRef, auditStreamRef, grants)],
    publications: [],
    currentSnapshotRef: baseSnapshotRef,
  };
}

export function publishApprovalRevision(stream, { grants, eventTime, arrivalOrder, outcome }) {
  if (!stream || !Array.isArray(stream.snapshots) || !Array.isArray(stream.publications)) {
    throw new Error('invalid approval stream');
  }
  requiredTime(eventTime, 'eventTime');
  requiredTime(arrivalOrder, 'arrivalOrder');
  if (!['completed', 'failed'].includes(outcome)) {
    throw new Error('approval revision outcome must be completed or failed');
  }
  const last = stream.publications.at(-1);
  if (last && eventTime <= last.event_time) {
    throw new Error('approval revision event times must be strictly increasing per stream');
  }
  const ordinal = stream.publications.length + 1;
  const newSnapshotRef = opaque('approvalsnap', stream.approval_stream_ref, ordinal);
  if (stream.snapshots.some((item) => item.snapshot_ref === newSnapshotRef)) {
    throw new Error('approval snapshot identity collision');
  }
  const candidate = snapshot(
    newSnapshotRef,
    stream.approval_stream_ref,
    stream.snapshots[0].audit_stream_ref,
    grants,
  );
  const publication = deepFreeze({
    event_id: opaque('approvalevt', stream.approval_stream_ref, ordinal),
    kind: 'approval-snapshot-revision',
    approval_stream_ref: stream.approval_stream_ref,
    previous_snapshot_ref: stream.currentSnapshotRef,
    new_snapshot_ref: newSnapshotRef,
    event_time: eventTime,
    arrival_order: arrivalOrder,
    outcome,
  });
  stream.snapshots.push(candidate);
  stream.publications.push(publication);
  if (outcome === 'completed') {
    stream.currentSnapshotRef = newSnapshotRef;
  }
  return publication;
}

export function selectEffectiveApproval(stream, readTime) {
  requiredTime(readTime, 'readTime');
  if (!stream || !Array.isArray(stream.snapshots) || !Array.isArray(stream.publications)) {
    throw new Error('invalid approval stream');
  }
  const snapshots = new Map();
  for (const item of stream.snapshots) {
    if (
      typeof item.snapshot_ref !== 'string' ||
      item.approval_stream_ref !== stream.approval_stream_ref ||
      snapshots.has(item.snapshot_ref)
    ) {
      throw new Error('approval snapshot identity or ownership invalid');
    }
    snapshots.set(item.snapshot_ref, item);
  }
  let selectedRef = stream.snapshots[0]?.snapshot_ref;
  if (typeof selectedRef !== 'string') {
    throw new Error('approval base snapshot missing');
  }
  const seenTimes = new Set();
  const publications = [...stream.publications].sort(
    (left, right) => left.event_time - right.event_time,
  );
  for (const item of publications) {
    if (
      !Number.isSafeInteger(item.event_time) ||
      item.approval_stream_ref !== stream.approval_stream_ref ||
      seenTimes.has(item.event_time) ||
      !snapshots.has(item.new_snapshot_ref)
    ) {
      throw new Error('approval publication is malformed or ambiguous');
    }
    seenTimes.add(item.event_time);
    if (item.event_time >= readTime) {
      break;
    }
    if (item.previous_snapshot_ref !== selectedRef) {
      throw new Error('approval publication predecessor is invalid');
    }
    if (item.outcome === 'completed') {
      selectedRef = item.new_snapshot_ref;
    } else if (item.outcome !== 'failed') {
      throw new Error('approval publication outcome is invalid');
    }
  }
  return snapshots.get(selectedRef);
}
