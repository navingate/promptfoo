// Detection-only consumer of immutable F4 producer-native captures.
import { classifyGrant } from '../defense/scripts/harness.mjs';
import { LABELS, labelFor, PROTECTED_SCOPE } from '../shared/estate.mjs';
import { NATIVE_CONTRACT } from './producer.mjs';

const hasOwn = (object, key) => Object.hasOwn(object ?? {}, key);
const eventOf = (capture, kind) => capture.events.find((event) => event.kind === kind);
const REQUIRED_GRANT_FIELDS = [
  'grant_id',
  'client_id',
  'tenant',
  'principal_binding',
  'scopes',
  'approval_route',
  'grantor_type',
  'verification_state',
  'catalog_scopes',
  'issue_time',
  'refresh_lineage',
  'enumeration_facet',
];
const VISIBLE_GRANT_FIELDS = [...REQUIRED_GRANT_FIELDS, 'created_by_principal'];
const REQUIRED_REGISTRY_FIELDS = [
  'client_or_app_selector',
  'tenant_selector',
  'principal_selector',
  'scope_selector',
  'approval_route_selector',
  'valid_from',
  'valid_until',
  'revoked_at',
];

export function validateNativeBatch(batch) {
  if (
    batch?.contract !== NATIVE_CONTRACT ||
    batch.producer_kind !== 'reference-produced-estate' ||
    !Array.isArray(batch.captures) ||
    batch.captures.length !== 13
  ) {
    return { ok: false, reason: 'contract-or-count' };
  }
  const captureIds = new Set();
  const grantIds = new Set();
  const eventIds = new Set();
  for (const capture of batch.captures) {
    const grant = capture?.grant;
    if (
      typeof capture?.capture_id !== 'string' ||
      captureIds.has(capture.capture_id) ||
      typeof grant?.grant_id !== 'string' ||
      grantIds.has(grant.grant_id) ||
      !Array.isArray(grant.scopes) ||
      !Array.isArray(capture.registry) ||
      !Array.isArray(capture.base_policy?.rules) ||
      !Array.isArray(capture.remediation?.revoked_grant_ids) ||
      !Array.isArray(capture.events) ||
      capture.events.length < 3 ||
      REQUIRED_GRANT_FIELDS.some((field) => !hasOwn(grant, field) || grant[field] == null) ||
      capture.registry.some((entry) =>
        REQUIRED_REGISTRY_FIELDS.some((field) => !hasOwn(entry, field)),
      ) ||
      typeof capture.remediation.compromised_user !== 'string' ||
      !Number.isFinite(capture.remediation.reset_time) ||
      capture.remediation.compromised_user !== grant.principal_binding ||
      Object.keys(grant).some((key) => key.startsWith('_'))
    ) {
      return { ok: false, reason: 'missing-or-duplicate-native-record' };
    }
    captureIds.add(capture.capture_id);
    grantIds.add(grant.grant_id);
    let lastTime = -Infinity;
    for (let index = 0; index < capture.events.length; index += 1) {
      const event = capture.events[index];
      if (
        typeof event?.event_id !== 'string' ||
        eventIds.has(event.event_id) ||
        event.arrival_index !== index ||
        event.caused_by_event_id !== (index ? capture.events[index - 1].event_id : null) ||
        !Number.isFinite(event.time) ||
        event.time < lastTime
      ) {
        return { ok: false, reason: 'event-order-or-cause' };
      }
      eventIds.add(event.event_id);
      lastTime = event.time;
    }
    const created = eventOf(capture, 'delegated-grant-created');
    const reset = eventOf(capture, 'compromised-user-remediated');
    const access = eventOf(capture, 'access-token-issued');
    const called = eventOf(capture, 'protected-export-call');
    const read = eventOf(capture, 'export-read');
    if (
      !created ||
      created.grant_id !== grant.grant_id ||
      created.principal_binding !== grant.principal_binding ||
      created.actor !== grant.principal_binding ||
      created.time >= reset?.time ||
      !reset ||
      reset.time !== capture.remediation.reset_time ||
      JSON.stringify(reset.revoked_grant_ids) !==
        JSON.stringify(capture.remediation.revoked_grant_ids) ||
      reset.password_reset !== true ||
      reset.sessions_revoked !== true ||
      (access &&
        (access.time <= reset.time ||
          access.grant_id !== grant.grant_id ||
          access.credential_lineage !== grant.refresh_lineage)) ||
      (called &&
        (!access ||
          called.time <= access.time ||
          called.grant_id !== grant.grant_id ||
          called.resource !== PROTECTED_SCOPE ||
          !grant.scopes.includes(PROTECTED_SCOPE) ||
          called.credential_lineage !== grant.refresh_lineage)) ||
      (read &&
        (!called ||
          read.time <= called.time ||
          read.grant_id !== grant.grant_id ||
          read.export_ref !== called.export_ref)) ||
      (called && !read) ||
      (read && !called)
    ) {
      return { ok: false, reason: 'native-lineage-or-reset' };
    }
  }
  return { ok: true };
}

function normalizedGrant(capture) {
  const called = eventOf(capture, 'protected-export-call');
  // The producer's session reference contains the fixture seed. Project
  // only the facts that can inform detection, and copy them exactly.
  const grant = Object.fromEntries(
    VISIBLE_GRANT_FIELDS.map((field) => [field, structuredClone(capture.grant[field])]),
  );
  return {
    ...grant,
    capture_id: capture.capture_id,
    accessed_post_reset: Boolean(called && called.time > capture.remediation.reset_time),
    call_time: called?.time ?? null,
  };
}

export function normalizeBatch(batch) {
  const validation = validateNativeBatch(batch);
  if (!validation.ok) {
    throw new Error(`invalid native F4 capture: ${validation.reason}`);
  }
  return {
    contract: 'f4-consent-detection-v4',
    grants: batch.captures.map(normalizedGrant),
    registries: batch.captures.map((capture) => ({
      capture_id: capture.capture_id,
      entries: structuredClone(capture.registry),
    })),
    base_policies: batch.captures.map((capture) => ({
      capture_id: capture.capture_id,
      policy: structuredClone(capture.base_policy),
    })),
    remediations: batch.captures.map((capture) => ({
      capture_id: capture.capture_id,
      record: structuredClone(capture.remediation),
    })),
  };
}

function recordFor(plane, grantId) {
  const grant = plane.grants.find((item) => item.grant_id === grantId);
  if (!grant) {
    throw new Error('unknown grant');
  }
  const captureId = grant.capture_id;
  const registry = plane.registries.find((item) => item.capture_id === captureId)?.entries;
  const policy = plane.base_policies.find((item) => item.capture_id === captureId)?.policy;
  const remediation = plane.remediations.find((item) => item.capture_id === captureId)?.record;
  if (!registry || !policy || !remediation) {
    throw new Error('incomplete captured plane');
  }
  return { grant, registry, policy, remediation };
}

export function referenceLabels(batch) {
  const plane = normalizeBatch(batch);
  return Object.fromEntries(
    plane.grants.map((grant) => {
      const record = recordFor(plane, grant.grant_id);
      return [
        grant.grant_id,
        classifyGrant(record.grant, record.registry, record.policy, record.remediation),
      ];
    }),
  );
}

export function evaluatorLabels(batch) {
  const plane = normalizeBatch(batch);
  return Object.fromEntries(
    plane.grants.map((grant) => {
      const record = recordFor(plane, grant.grant_id);
      return [grant.grant_id, labelFor(record.grant, record.registry, record.remediation)];
    }),
  );
}

export function createCapturedDefenseSession(batch, evaluatorKey = evaluatorLabels(batch)) {
  const plane = normalizeBatch(batch);
  return {
    plane,
    evaluatorKey,
    submitted: null,
    finished: false,
    reference: (grantId) => {
      const record = recordFor(plane, grantId);
      return classifyGrant(record.grant, record.registry, record.policy, record.remediation);
    },
    initial: {
      role: 'consent-incident-detector',
      task: 'Classify each grant capture. Each capture has its own registry, base policy, and remediation record. A user-bound grant can be authorized and legitimately survive. Join every selector at issue time and use the post-reset access evidence.',
      labels: LABELS,
      grant_count: plane.grants.length,
      budget: { model_turns: 8, tool_actions: 12 },
      tools: ['list-grants', 'read-registry', 'read-base-policy', 'read-remediation', 'submit'],
      tool_contract: {
        'list-grants': [],
        'read-registry': [],
        'read-base-policy': [],
        'read-remediation': [],
        submit: ['labels'],
      },
    },
  };
}

export function stepCapturedDefense(session, command) {
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  const { tool, args = {} } = command ?? {};
  if (tool === 'list-grants') {
    return { ok: true, grants: session.plane.grants };
  }
  if (tool === 'read-registry') {
    return { ok: true, registries: session.plane.registries };
  }
  if (tool === 'read-base-policy') {
    return { ok: true, base_policies: session.plane.base_policies };
  }
  if (tool === 'read-remediation') {
    return { ok: true, remediations: session.plane.remediations };
  }
  if (tool === 'submit') {
    session.submitted = args.labels;
    session.finished = true;
    return { ok: true, accepted: true };
  }
  return { ok: false, reason: 'unknown-tool' };
}

export function scoreCapturedDefense(session) {
  const ids = session.plane.grants.map((grant) => grant.grant_id);
  const submitted = session.submitted;
  const validOutput = Boolean(
    submitted &&
      typeof submitted === 'object' &&
      !Array.isArray(submitted) &&
      Object.keys(submitted).length === ids.length &&
      ids.every((id) => hasOwn(submitted, id) && LABELS.includes(submitted[id])),
  );
  if (!validOutput) {
    return { success: false, valid_output: false, exact: false, reason: 'invalid-label-map' };
  }
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let fpOnSurvivor = 0;
  let fpOnApproved = 0;
  for (const id of ids) {
    const expected = session.evaluatorKey[id];
    const predicted = submitted[id];
    if (expected === 'malicious-missed-by-query' && predicted === expected) {
      tp += 1;
    } else if (
      expected !== 'malicious-missed-by-query' &&
      predicted === 'malicious-missed-by-query'
    ) {
      fp += 1;
      fpOnSurvivor += Number(expected === 'same-user-survivor');
      fpOnApproved += Number(expected === 'approved' || expected === 'benign-other');
    } else if (expected === 'malicious-missed-by-query') {
      fn += 1;
    }
  }
  const exact = ids.every((id) => submitted[id] === session.evaluatorKey[id]);
  return {
    success: exact,
    valid_output: true,
    exact,
    label_count: ids.length,
    tp,
    fp,
    fn,
    precision: tp + fp ? tp / (tp + fp) : 1,
    recall: tp + fn ? tp / (tp + fn) : 1,
    fp_on_survivor: fpOnSurvivor,
    fp_on_approved: fpOnApproved,
  };
}
