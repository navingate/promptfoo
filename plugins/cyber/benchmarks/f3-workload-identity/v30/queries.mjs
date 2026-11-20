import {
  listWorkloads as listCoreWorkloads,
  querySession as queryCoreSession,
  querySource as queryCoreSource,
} from '../v22/queries.mjs';
import { queryWorkload as queryCoreWorkload } from '../v23/queries.mjs';

const INDEX_KEYS = {
  credential: 'credential_ids',
  job: 'job_uids',
  session: 'access_key_refs',
};

export function listWorkloads(visible) {
  const core = listCoreWorkloads(visible);
  const mixed = { ...core, credential_ids: [], job_uids: [], access_key_refs: [] };
  for (const entry of visible.triage_index.entries) {
    const key = INDEX_KEYS[entry.entry_type];
    if (!key) {
      throw new Error('v30 index has unknown evidence type');
    }
    mixed[key].push(entry.entry_id);
  }
  return { ...mixed, evidence_index: visible.triage_index };
}

function archiveObservation(visible, type, id) {
  const entry = visible.triage_index.entries.find(
    (item) => item.entry_type === type && item.entry_id === id,
  );
  if (!entry) {
    return null;
  }
  return {
    partition: 'adjacent-archive',
    entry_type: type,
    entry_id: id,
    retention_checked_at: visible.triage_time,
  };
}

export function querySource(visible, credentialId) {
  if (listCoreWorkloads(visible).credential_ids.includes(credentialId)) {
    return queryCoreSource(visible, credentialId);
  }
  const archive = archiveObservation(visible, 'credential', credentialId);
  return archive ? { events: [], grant_snapshots: [], membership_audit: [], archive } : null;
}

export function queryWorkload(visible, jobUid) {
  if (listCoreWorkloads(visible).job_uids.includes(jobUid)) {
    return queryCoreWorkload(visible, jobUid);
  }
  const archive = archiveObservation(visible, 'job', jobUid);
  return archive
    ? {
        events: [],
        approval_snapshots: [],
        approval_publications: [],
        membership_audit: [],
        job_queue: [],
        archive,
      }
    : null;
}

export function querySession(visible, accessKeyRef) {
  if (listCoreWorkloads(visible).access_key_refs.includes(accessKeyRef)) {
    return queryCoreSession(visible, accessKeyRef);
  }
  const archive = archiveObservation(visible, 'session', accessKeyRef);
  return archive ? { events: [], session_register: [], policy_snapshots: [], archive } : null;
}
