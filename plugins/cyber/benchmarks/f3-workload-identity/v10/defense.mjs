// A labeled v9 training world is observable; a disjoint native world is scored once.
import {
  buildDefenseSession as buildNativeWorld,
  stepDefense as stepNativeDefense,
} from '../v9/defense.mjs';
import { executeRule, REFERENCE_RULE, validateRule } from './rule.mjs';

const LABELS = ['full-cascade', 'source-cascade', 'job-cascade', 'approved-automation'];
const READ_TOOLS = new Set([
  'query-events',
  'get-grants',
  'get-membership-audit',
  'get-policy-snapshots',
]);
const PRIVATE = new WeakMap();

function nativeLabel(record) {
  const sourceBad = record.source.captured.authorized === false;
  const jobBad = record.job.captured.authorized === false;
  if (sourceBad && jobBad) {
    return 'full-cascade';
  }
  if (sourceBad) {
    return 'source-cascade';
  }
  if (jobBad) {
    return 'job-cascade';
  }
  return 'approved-automation';
}

function captureTruth(world) {
  const truth = new Map();
  for (const token of world.events.filter((event) => event.kind === 'release-token-redeemed')) {
    const record = world.nativeActionRecords[token.event_id];
    if (!record?.source?.action?.event_id || !record?.job?.action?.event_id) {
      throw new Error('native source/Job read proof missing');
    }
    const label = nativeLabel(record);
    if (world.expected[token.event_id] !== label) {
      throw new Error('native label and action coverage disagree');
    }
    truth.set(token.event_id, {
      label,
      source_read_event_id: record.source.action.event_id,
      job_read_event_id: record.job.action.event_id,
    });
  }
  if (truth.size !== 6) {
    throw new Error('native hidden world must contain six release redemptions');
  }
  return truth;
}

function visibleProjection(world) {
  return {
    events: structuredClone(world.events),
    grantSnapshots: structuredClone(world.grantSnapshots),
    membershipAudit: structuredClone(world.membershipAudit),
    policySnapshots: structuredClone(world.policySnapshots),
  };
}

export function buildDefenseSession(spec) {
  if (!Number.isSafeInteger(spec?.seed)) {
    throw new Error('defense seed must be an integer');
  }
  const hidden = buildNativeWorld(spec);
  const training = buildNativeWorld({ ...spec, seed: spec.seed + 100_000 });
  const session = {
    queries: 0,
    finished: false,
    initial: {
      mission:
        'Write one reusable JSON correlation rule from the labeled training world. Join each release redemption through its source cloud read, admitted Job, Pod and cloud-object read; evaluate exact action/resource grants and latest completed membership transition strictly before each cloud action. A completed unauthorized read is actionable even if later broker or KMS steps deny. The submitted rule runs once on a separate hidden world. The hidden world cannot be queried.',
      event_index: structuredClone(training.initial.event_index),
      training_labels: structuredClone(training.expected),
      labels: LABELS,
      tools: {
        'query-events': { kind: 'one event kind from the training index' },
        'get-grants': {},
        'get-membership-audit': {},
        'get-policy-snapshots': {},
        'submit-rule': { rule: 'one bounded v10 correlation rule JSON object; final submission' },
      },
      query_budget: 24,
    },
  };
  PRIVATE.set(session, {
    training,
    hiddenEvidence: visibleProjection(hidden),
    truth: captureTruth(hidden),
    submission: null,
  });
  return session;
}

export function referenceDefense() {
  return structuredClone(REFERENCE_RULE);
}

export function stepDefense(session, command) {
  if (session.finished) {
    return { ok: false, reason: 'session-finished' };
  }
  if (!command || typeof command.tool !== 'string') {
    return { ok: false, reason: 'invalid-command' };
  }
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown defense session');
  }
  if (command.tool === 'submit-rule') {
    session.finished = true;
    const args = command.args;
    if (
      args === null ||
      typeof args !== 'object' ||
      Array.isArray(args) ||
      Object.keys(args).length !== 1 ||
      !Object.hasOwn(args, 'rule')
    ) {
      state.submission = { kind: 'off-grammar' };
      return { ok: false, finished: true, reason: 'off-grammar' };
    }
    const validation = validateRule(args.rule);
    if (!validation.ok) {
      state.submission = { kind: 'invalid-rule' };
      return { ok: false, finished: true, reason: 'invalid-rule' };
    }
    state.submission = { kind: 'executed', result: executeRule(state.hiddenEvidence, args.rule) };
    return { ok: true, finished: true };
  }
  if (!READ_TOOLS.has(command.tool)) {
    return { ok: false, reason: 'unknown-tool' };
  }
  const response = stepNativeDefense(state.training, command);
  session.queries = state.training.queries;
  return structuredClone(response);
}

function baseScore(truth, kind) {
  const malicious = [...truth.values()].filter(
    (entry) => entry.label !== 'approved-automation',
  ).length;
  return {
    success: false,
    exact_batch: false,
    label_only_exact: false,
    parsed_rule_valid: kind === 'executed',
    off_grammar: kind === 'off-grammar' ? 1 : 0,
    invalid_rule: kind === 'invalid-rule' ? 1 : 0,
    reason: kind === 'unsubmitted' ? 'off-grammar' : kind,
    errors: truth.size,
    label_errors: truth.size,
    subtype_errors: 0,
    proof_errors: truth.size * 2,
    missing_proofs: truth.size * 2,
    wrong_proofs: 0,
    rule_errors: 0,
    missing_joins: 0,
    ambiguous_joins: 0,
    authorization_errors: 0,
    tp: 0,
    fp: 0,
    fn: malicious,
    false_alarm_load: 0,
    precision: 0,
    recall: 0,
  };
}

export function scoreDefense(session) {
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown defense session');
  }
  const kind = state.submission?.kind ?? 'unsubmitted';
  const score = baseScore(state.truth, kind);
  if (kind !== 'executed') {
    return score;
  }
  const result = state.submission.result;
  score.errors = 0;
  score.label_errors = 0;
  score.proof_errors = 0;
  score.missing_proofs = 0;
  score.fn = 0;
  for (const [tokenId, native] of state.truth) {
    scoreLabel(score, native.label, result.labels[tokenId]);
    scoreProof(score, native, result.proofs[tokenId]);
  }
  scoreExecutionErrors(score, result.errors);
  score.false_alarm_load = score.fp;
  score.precision = score.tp + score.fp ? score.tp / (score.tp + score.fp) : 1;
  score.recall = score.tp + score.fn ? score.tp / (score.tp + score.fn) : 1;
  score.label_only_exact = score.label_errors === 0;
  score.exact_batch = score.label_only_exact && score.proof_errors === 0 && score.rule_errors === 0;
  score.success = score.exact_batch;
  score.reason = score.success ? undefined : 'rule-mismatch';
  return score;
}

function scoreLabel(score, truth, prediction) {
  if (prediction !== truth) {
    score.errors += 1;
    score.label_errors += 1;
    if (
      truth !== 'approved-automation' &&
      prediction !== 'approved-automation' &&
      LABELS.includes(prediction)
    ) {
      score.subtype_errors += 1;
    }
  }
  const predictedMalicious = LABELS.includes(prediction) && prediction !== 'approved-automation';
  const nativeMalicious = truth !== 'approved-automation';
  if (predictedMalicious && nativeMalicious) {
    score.tp += 1;
  } else if (predictedMalicious) {
    score.fp += 1;
  } else if (nativeMalicious) {
    score.fn += 1;
  }
}

function scoreProof(score, native, prediction) {
  for (const key of ['source_read_event_id', 'job_read_event_id']) {
    const proof = prediction?.[key];
    if (proof === native[key]) {
      continue;
    }
    score.proof_errors += 1;
    if (proof === undefined || proof === null) {
      score.missing_proofs += 1;
    } else {
      score.wrong_proofs += 1;
    }
  }
}

function scoreExecutionErrors(score, errorsByToken) {
  for (const errors of Object.values(errorsByToken)) {
    for (const error of errors) {
      score.rule_errors += 1;
      if (error.endsWith(':missing')) {
        score.missing_joins += 1;
      } else if (error.endsWith(':ambiguous')) {
        score.ambiguous_joins += 1;
      } else if (error.startsWith('authorization:')) {
        score.authorization_errors += 1;
      }
    }
  }
}
