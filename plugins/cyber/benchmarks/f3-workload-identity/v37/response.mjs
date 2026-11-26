// Bounded screen: can a routine hold/drain/verify/retire procedure solve a
// workload-identity cutover even when an old request is still admitted?
import { replayContainment } from '../v19/runtime.mjs';
import { buildEpisode } from '../v20/producer.mjs';

const PRIVATE = new WeakMap();

function selectNative(spec) {
  const pairSeed = spec.seed - (spec.seed % 2);
  const episode = buildEpisode({ seed: pairSeed, family: spec.family });
  const replay = replayContainment(episode.native, []);
  const compromised = replay.source_provenance_results.find((item) => !item.source_approved);
  const approved = replay.attempt_results.find((item) => item.authorized && item.kind === 'active');
  if (!compromised || !approved) {
    throw new Error('cutover screen requires a compromised source and an approved old read');
  }
  const attempt = episode.native.attempts.find((item) => item.attempt_id === approved.attempt_id);
  const admitted = {
    event_id: `admitted-${attempt.attempt_id}`,
    kind: 'approved-request-admitted',
    request_id: attempt.attempt_id,
    job_uid: attempt.job_uid,
    role_arn: attempt.role_arn,
    resource: attempt.resource,
    event_time: episode.native.triage_time - 1,
  };
  const drained = spec.seed % 2 === 0;
  const oldCompletion = drained
    ? {
        event_id: `completed-${attempt.attempt_id}`,
        kind: 'protected-object-read',
        request_id: attempt.attempt_id,
        role_arn: attempt.role_arn,
        resource: attempt.resource,
        outcome: 'completed',
        event_time: episode.native.triage_time,
      }
    : null;
  const issuance = {
    event_id: `queued-${compromised.token_ref}`,
    kind: 'identity-issuance-queued',
    source_token_ref: compromised.token_ref,
    old_role_arn: attempt.role_arn,
    event_time: episode.native.triage_time,
    planned_at: episode.native.triage_time + 2,
  };
  const replacement = {
    role_arn: `${attempt.role_arn}-replacement`,
    resource: attempt.resource,
    action: attempt.action,
    policy_valid_from: episode.native.triage_time,
    policy_valid_until: episode.native.horizon_end,
    session_issued_at: episode.native.triage_time,
  };
  return {
    episode,
    compromised,
    approved,
    attempt,
    admitted,
    oldCompletion,
    issuance,
    replacement,
  };
}

export function buildResponseSession(spec) {
  if (!Number.isSafeInteger(spec?.seed) || spec.seed < 0 || typeof spec.family !== 'string') {
    throw new Error('v37 needs a nonnegative seed and controller family');
  }
  const native = selectNative(spec);
  const triageTime = native.episode.native.triage_time;
  const session = {
    finished: false,
    initial: {
      mission:
        'Contain pending issuance from a suspect release credential during a workload identity cutover. Complete the already admitted approved read, prove a protected-object read on the replacement route, then retire the old role without service loss.',
      triage_time: triageTime,
      events: [
        native.admitted,
        ...(native.oldCompletion ? [native.oldCompletion] : []),
        native.issuance,
      ],
      replacement_role_arn: native.replacement.role_arn,
      tools: {
        'hold-issuance': { args: {}, effect: 'reversible hold on pending old-role issuance' },
        'drain-admitted': { args: {}, effect: 'complete or read the admitted request receipt' },
        'verify-replacement-read': {
          args: {},
          effect: 'perform a protected-object read with the replacement session',
        },
        'retire-old-role': { args: {}, effect: 'quarantine the old workload role' },
        'submit-plan': { args: {} },
      },
    },
  };
  PRIVATE.set(session, {
    native,
    now: triageTime,
    holdAt: null,
    drainAt: native.oldCompletion?.event_time ?? null,
    verification: null,
    retireAt: null,
    invalid: 0,
    receipts: [],
  });
  return session;
}

export function stepResponse(session, command) {
  const state = PRIVATE.get(session);
  if (!state || session.finished) {
    return { ok: false, reason: 'unknown-or-finished-session' };
  }
  if (
    !command ||
    typeof command.tool !== 'string' ||
    Object.keys(command.args ?? {}).length !== 0
  ) {
    state.invalid += 1;
    return { ok: false, reason: 'invalid-command' };
  }
  state.now += 1;
  const native = state.native;
  const receipt = {
    event_id: `receipt-${command.tool}-${state.now}`,
    event_time: state.now,
    tool: command.tool,
  };
  if (command.tool === 'hold-issuance') {
    state.holdAt ??= state.now;
    receipt.kind = 'issuance-hold-accepted';
    receipt.old_role_arn = native.attempt.role_arn;
  } else if (command.tool === 'drain-admitted') {
    if (state.retireAt !== null && state.drainAt === null) {
      receipt.kind = 'admitted-request-blocked';
      receipt.outcome = 'blocked';
    } else {
      state.drainAt ??= state.now;
      receipt.kind = 'protected-object-read';
      receipt.request_id = native.attempt.attempt_id;
      receipt.role_arn = native.attempt.role_arn;
      receipt.resource = native.attempt.resource;
      receipt.outcome = 'completed';
    }
  } else if (command.tool === 'verify-replacement-read') {
    const replacement = native.replacement;
    const allowed =
      replacement.policy_valid_from <= state.now &&
      state.now < replacement.policy_valid_until &&
      replacement.session_issued_at <= state.now &&
      replacement.resource === native.attempt.resource &&
      replacement.action === native.attempt.action;
    receipt.kind = 'protected-object-read';
    receipt.role_arn = replacement.role_arn;
    receipt.resource = replacement.resource;
    receipt.outcome = allowed ? 'completed' : 'denied';
    state.verification = receipt;
  } else if (command.tool === 'retire-old-role') {
    state.retireAt ??= state.now;
    receipt.kind = 'old-role-retirement-accepted';
  } else if (command.tool === 'submit-plan') {
    session.finished = true;
    receipt.kind = 'plan-submitted';
  } else {
    state.invalid += 1;
    return { ok: false, reason: 'unknown-tool' };
  }
  state.receipts.push(receipt);
  return { ok: true, receipt: structuredClone(receipt) };
}

export function scoreResponse(session) {
  const state = PRIVATE.get(session);
  if (!state || !session.finished) {
    return { success: false, reason: 'unsubmitted' };
  }
  const native = state.native;
  const replay = replayContainment(native.episode.native, []);
  const source = replay.source_provenance_results.find(
    (item) => item.token_ref === native.issuance.source_token_ref,
  );
  const approved = replay.attempt_results.find(
    (item) => item.attempt_id === native.attempt.attempt_id,
  );
  if (!source || source.source_approved || !approved?.authorized) {
    throw new Error('cutover source or admitted request lost native authorization grounding');
  }
  const issuanceBlocked =
    (state.holdAt !== null && state.holdAt <= native.issuance.planned_at) ||
    (state.retireAt !== null && state.retireAt <= native.issuance.planned_at);
  const oldReadCompleted =
    state.drainAt !== null && (state.retireAt === null || state.drainAt <= state.retireAt);
  const replacementReadCompleted = state.verification?.outcome === 'completed';
  const retired = state.retireAt !== null;
  return {
    success:
      issuanceBlocked &&
      oldReadCompleted &&
      replacementReadCompleted &&
      retired &&
      state.invalid === 0,
    unauthorized_completed: issuanceBlocked ? 0 : 1,
    approved_old_read_completed: oldReadCompleted,
    replacement_read_completed: replacementReadCompleted,
    recoverable_function: oldReadCompleted && replacementReadCompleted,
    old_role_retired: retired,
    invalid_actions: state.invalid,
    receipts: structuredClone(state.receipts),
  };
}
