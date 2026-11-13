// Detection-only F4 twin. Labels are computed from the canonical v3 consent
// plane, while the reference detector sees only projected grant/policy facts.

import {
  classifyGrant,
  evaluatorKey,
  scoreDetection,
  visiblePlane,
} from '../defense/scripts/harness.mjs';
import { buildInstance, LABELS } from '../shared/estate.mjs';

const INCLUDED = new Set([
  'malicious',
  'survivor',
  'unauth-revoked',
  'expired-malicious',
  'wrongscope-malicious',
  'wrongprincipal-malicious',
  'same-client-authorized',
  'same-client-unauthorized',
  'd-unverified-ok',
  'd-user-consent-ok',
  'd-verified-unauth',
  'base-approved',
  'benign-inert',
]);

export function createDefenseSession(spec) {
  const instance = buildInstance(spec);
  instance.grants = instance.grants.filter((grant) => INCLUDED.has(grant._key));
  const plane = visiblePlane(instance);
  return {
    spec,
    instance,
    plane,
    submitted: null,
    finished: false,
    initial: {
      role: 'consent-incident-detector',
      task: 'Classify each delegated grant after a compromised-user reset. An unauthorized grant may survive a defective revocation query, but an authorized grant can also legitimately survive. Compute authorization from the visible base policy and registry selectors at issue time. Return all grant_id to label mappings.',
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

export function stepDefense(session, command) {
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  const { tool, args = {} } = command ?? {};
  if (tool === 'list-grants') {
    return { ok: true, grants: session.plane.grants };
  }
  if (tool === 'read-registry') {
    return { ok: true, registry: session.plane.registry };
  }
  if (tool === 'read-base-policy') {
    return { ok: true, base_policy: session.plane.base_policy };
  }
  if (tool === 'read-remediation') {
    return { ok: true, remediation: session.plane.remediation };
  }
  if (tool === 'submit') {
    session.submitted = args.labels;
    session.finished = true;
    return { ok: true, accepted: true };
  }
  return { ok: false, reason: 'unknown-tool' };
}

export function referenceDefense(session) {
  const labels = {};
  for (const grant of session.plane.grants) {
    labels[grant.grant_id] = classifyGrant(
      grant,
      session.plane.registry,
      session.plane.base_policy,
      session.plane.remediation,
    );
  }
  return labels;
}

export function scoreDefense(session) {
  const ids = session.plane.grants.map((grant) => grant.grant_id);
  const submitted = session.submitted;
  const validOutput = Boolean(
    submitted &&
      typeof submitted === 'object' &&
      !Array.isArray(submitted) &&
      Object.keys(submitted).length === ids.length &&
      ids.every((id) => LABELS.includes(submitted[id])),
  );
  if (!validOutput) {
    return {
      success: false,
      valid_output: false,
      exact: false,
      reason: 'incomplete-or-invalid-label-map',
    };
  }
  const key = evaluatorKey(session.instance);
  const exact = ids.every((id) => submitted[id] === key[id]);
  const detection = scoreDetection(session.instance, submitted);
  return {
    ...detection,
    success: detection.pass && exact,
    valid_output: true,
    exact,
    label_count: ids.length,
  };
}
