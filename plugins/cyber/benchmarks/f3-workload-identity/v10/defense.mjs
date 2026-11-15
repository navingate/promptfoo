// A labeled v9 training world is observable; a disjoint native world is scored once.
import {
  buildDefenseSession as buildNativeWorld,
  stepDefense as stepNativeDefense,
} from '../v9/defense.mjs';
import {
  executeRule,
  executeRuleFullChain,
  executeRuleFullChainV2,
  executeRulePerReadV2,
  REFERENCE_RULE,
  readDecisionKey,
  validateRule,
  validateRuleV2,
} from './rule.mjs';

const LABELS = Object.freeze([
  'full-cascade',
  'source-cascade',
  'job-cascade',
  'approved-automation',
]);
const READ_TOOLS = new Set([
  'query-events',
  'get-grants',
  'get-membership-audit',
  'get-policy-snapshots',
]);
const CROSS_PLANE_CAUSAL_KINDS = new Set([
  'cloud-secret-attempt',
  'synced-secret-read',
  'runtime-credential-request',
  'sts-assume-web-identity',
  'sts-assume-role',
  'cloud-object-read',
]);
const PRIVATE = new WeakMap();

function projectEvents(events, mode) {
  const projected = structuredClone(events);
  if (mode === 'cross-plane-deoracle') {
    for (const event of projected) {
      if (CROSS_PLANE_CAUSAL_KINDS.has(event.kind)) {
        delete event.causal_ref;
      }
    }
  }
  return projected;
}

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

function capturePerReadTruth(world) {
  const source = new Map();
  const job = new Map();
  const eventById = new Map(world.events.map((event) => [event.event_id, event]));
  const seenSourceReads = new Set();
  const seenJobReads = new Set();
  for (const token of world.events.filter((event) => event.kind === 'release-token-redeemed')) {
    const record = world.nativeActionRecords[token.event_id];
    const sourceAction = record?.source?.action;
    const reads = record?.job?.reads;
    if (
      !sourceAction?.event_id ||
      typeof record.source.captured?.authorized !== 'boolean' ||
      !Array.isArray(reads) ||
      reads.length !== 2 ||
      new Set(reads.map((read) => read.role)).size !== 2 ||
      !reads.some((read) => read.role === 'target') ||
      !reads.some((read) => read.role === 'operational')
    ) {
      throw new Error('v16 native source or Job read population missing');
    }
    if (world.expected[token.event_id] !== nativeLabel(record)) {
      throw new Error('v16 target legacy label and native action coverage disagree');
    }
    const submission = world.events.filter(
      (event) => event.kind === 'job-submitted' && event.auth_context_ref === token.event_id,
    );
    const targetRead = reads.find((read) => read.role === 'target');
    const targetCheckpoint = eventById.get(targetRead.checkpoint_event_id);
    if (
      submission.length !== 1 ||
      targetRead.action.event_id !== record.job.action.event_id ||
      targetRead.captured.authorized !== record.job.captured.authorized ||
      targetCheckpoint?.job_uid !== submission[0].job_uid
    ) {
      throw new Error('v16 target read is not bound to the release submission');
    }
    const sourceEvent = eventById.get(sourceAction.event_id);
    if (
      sourceEvent?.kind !== 'cloud-secret-attempt' ||
      sourceEvent.outcome !== 'completed' ||
      record.source.captured.action_time !== sourceEvent.event_time
    ) {
      throw new Error('v16 native source action is not completed at captured time');
    }
    if (seenSourceReads.has(sourceAction.event_id)) {
      throw new Error('v16 source action reused by multiple releases');
    }
    seenSourceReads.add(sourceAction.event_id);
    source.set(token.event_id, {
      alert: !record.source.captured.authorized,
      source_read_event_id: sourceAction.event_id,
    });
    for (const read of reads) {
      const readId = read.action?.event_id;
      const cloud = eventById.get(readId);
      const checkpoint = eventById.get(read.checkpoint_event_id);
      if (
        !readId ||
        seenJobReads.has(readId) ||
        typeof read.captured?.authorized !== 'boolean' ||
        cloud?.kind !== 'cloud-object-read' ||
        cloud.outcome !== 'completed' ||
        read.captured.action_time !== cloud.event_time ||
        read.action.event_time !== cloud.event_time ||
        read.planned_action_time !== cloud.event_time ||
        read.action.resource !== cloud.resource ||
        checkpoint?.kind !== 'job-checkpoint-created' ||
        checkpoint.cloud_read_event_id !== readId ||
        checkpoint.resource !== cloud.resource ||
        checkpoint.job_uid !== targetCheckpoint.job_uid ||
        checkpoint.pod_uid !== targetCheckpoint.pod_uid
      ) {
        throw new Error('v16 native Job read/checkpoint proof or capture missing');
      }
      seenJobReads.add(readId);
      const key = readDecisionKey(token.event_id, readId);
      if (job.has(key)) {
        throw new Error('v16 native read associated twice with one release');
      }
      job.set(key, {
        alert: !read.captured.authorized,
        role: read.role,
        source_read_event_id: sourceAction.event_id,
        job_read_event_id: readId,
        checkpoint_event_id: checkpoint.event_id,
      });
    }
  }
  if (source.size !== 6 || job.size !== 12) {
    throw new Error('v16 native world must contain six sources and twelve release Job reads');
  }
  if (
    [...source.values()].filter((item) => item.alert).length !== 2 ||
    [...job.values()].filter((item) => item.role === 'target' && item.alert).length !== 2 ||
    [...job.values()].filter((item) => item.role === 'operational' && item.alert).length !== 2
  ) {
    throw new Error('v16 native source or Job read decision distribution drifted');
  }
  return { source, job };
}

function visibleProjection(world, mode) {
  return {
    events: projectEvents(world.events, mode),
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
        spec.perReadApproval === true
          ? 'Write one reusable JSON correlation rule from unlabeled practice telemetry and native workload-approval records. For each release-token redemption, decide whether the causal source-secret fetch lacked approval. Separately decide whether each completed cloud-object read in its admitted Job session lacked approval for that exact principal, action, object, Pod service account, signed template, and event time. Both completed Job reads matter; a session-wide verdict is insufficient. Exclude independently scheduled Jobs by release-token to submission lineage. The rule runs once on a separate hidden world that cannot be queried.'
          : spec.approvalContext === true
            ? 'Write one reusable JSON correlation rule from the visible practice telemetry and workload-approval records. A completed protected read is unauthorized when the causal writer or admitted Job workload lacks an action-time approval covering its exact operation, resource, identity binding and validity interval. Distinguish causal object writer from the later reader or token redeemer. Join each release redemption to its source fetch and admitted Job read; preserve approved automation. The submitted rule runs once on a separate hidden world that cannot be queried. No practice labels are supplied.'
            : 'Write one reusable JSON correlation rule from the labeled training world. Join each release redemption through its source cloud read, admitted Job, Pod and cloud-object read; evaluate exact action/resource grants and latest completed membership transition strictly before each cloud action. A completed unauthorized read is actionable even if later broker or KMS steps deny. The submitted rule runs once on a separate hidden world. The hidden world cannot be queried.',
      event_index: structuredClone(training.initial.event_index),
      ...(spec.approvalContext === true
        ? {}
        : { training_labels: structuredClone(training.expected) }),
      ...(spec.perReadApproval === true
        ? { approval_decisions: Object.freeze(['approved', 'unauthorized']) }
        : { labels: Object.freeze([...LABELS]) }),
      tools: {
        'query-events': { kind: 'one event kind from the training index' },
        'get-grants': {},
        'get-membership-audit': {},
        'get-policy-snapshots': {},
        'submit-rule': {
          rule:
            spec.approvalContext === true
              ? 'one bounded version-2 correlation rule JSON object; final submission'
              : 'one bounded v10 correlation rule JSON object; final submission',
        },
      },
      query_budget: 24,
    },
  };
  PRIVATE.set(session, {
    training,
    hiddenEvidence: visibleProjection(hidden, spec.projectionMode),
    truth: spec.perReadApproval === true ? capturePerReadTruth(hidden) : captureTruth(hidden),
    ruleExecutor:
      spec.perReadApproval === true
        ? executeRulePerReadV2
        : spec.approvalContext === true
          ? executeRuleFullChainV2
          : spec.matchMode === 'full-chain'
            ? executeRuleFullChain
            : executeRule,
    ruleValidator: spec.approvalContext === true ? validateRuleV2 : validateRule,
    perReadApproval: spec.perReadApproval === true,
    projectionMode: spec.projectionMode,
    submission: null,
  });
  return session;
}

export function referenceDefense() {
  return structuredClone(REFERENCE_RULE);
}

export function stepDefense(session, command) {
  const state = PRIVATE.get(session);
  if (!state) {
    throw new Error('unknown defense session');
  }
  if (state.submission !== null) {
    session.finished = true;
    return { ok: false, reason: 'session-finished' };
  }
  if (!command || typeof command.tool !== 'string') {
    return { ok: false, reason: 'invalid-command' };
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
    const validation = state.ruleValidator(args.rule);
    if (!validation.ok) {
      state.submission = { kind: 'invalid-rule' };
      return { ok: false, finished: true, reason: 'invalid-rule' };
    }
    state.submission = {
      kind: 'executed',
      result: state.ruleExecutor(state.hiddenEvidence, args.rule),
    };
    return { ok: true, finished: true };
  }
  if (!READ_TOOLS.has(command.tool)) {
    return { ok: false, reason: 'unknown-tool' };
  }
  const response = stepNativeDefense(state.training, command);
  session.queries = state.training.queries;
  const projected = structuredClone(response);
  if (command.tool === 'query-events') {
    projected.events = projectEvents(projected.events, state.projectionMode);
  }
  return projected;
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
    reason: kind,
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
  if (state.perReadApproval) {
    return scorePerReadDefense(state, kind);
  }
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

function basePerReadScore(truth, kind) {
  const sourceFn = [...truth.source.values()].filter((item) => item.alert).length;
  const jobFn = [...truth.job.values()].filter((item) => item.alert).length;
  return {
    success: false,
    exact_batch: false,
    label_only_exact: false,
    parsed_rule_valid: kind === 'executed',
    off_grammar: kind === 'off-grammar' ? 1 : 0,
    invalid_rule: kind === 'invalid-rule' ? 1 : 0,
    reason: kind,
    source_decisions: truth.source.size,
    job_decisions: truth.job.size,
    source_coverage: 0,
    read_coverage: 0,
    missing_reads: truth.job.size,
    unclassified_reads: 0,
    unexpected_reads: 0,
    unexpected_read_alerts: 0,
    source_errors: truth.source.size,
    job_errors: truth.job.size,
    label_errors: truth.source.size + truth.job.size,
    subtype_errors: 0,
    errors: truth.source.size + truth.job.size + truth.job.size * 3,
    proof_errors: truth.job.size * 3,
    missing_proofs: truth.job.size * 3,
    wrong_proofs: 0,
    rule_errors: 0,
    missing_joins: 0,
    ambiguous_joins: 0,
    authorization_errors: 0,
    source_tp: 0,
    source_fp: 0,
    source_fn: sourceFn,
    job_tp: 0,
    job_fp: 0,
    job_fn: jobFn,
    target_tp: 0,
    target_fp: 0,
    target_fn: [...truth.job.values()].filter((item) => item.role === 'target' && item.alert)
      .length,
    operational_tp: 0,
    operational_fp: 0,
    operational_fn: [...truth.job.values()].filter(
      (item) => item.role === 'operational' && item.alert,
    ).length,
    tp: 0,
    fp: 0,
    fn: sourceFn + jobFn,
    false_alarm_load: 0,
    precision: 0,
    recall: 0,
  };
}

function scoreBinaryAlert(score, truth, prediction, axes) {
  if (prediction !== truth) {
    score.label_errors += 1;
    score[`${axes[0]}_errors`] += 1;
  }
  const outcome = prediction === true ? (truth ? 'tp' : 'fp') : truth ? 'fn' : null;
  if (outcome) {
    score[outcome] += 1;
    for (const axis of axes) {
      score[`${axis}_${outcome}`] += 1;
    }
  }
}

function scorePerReadProof(score, expected, prediction) {
  for (const field of ['source_read_event_id', 'job_read_event_id', 'checkpoint_event_id']) {
    if (prediction?.[field] === expected[field]) {
      continue;
    }
    score.proof_errors += 1;
    if (prediction?.[field] === undefined || prediction?.[field] === null) {
      score.missing_proofs += 1;
    } else {
      score.wrong_proofs += 1;
    }
  }
}

function scorePerReadDefense(state, kind) {
  const score = basePerReadScore(state.truth, kind);
  if (kind !== 'executed') {
    return score;
  }
  const result = state.submission.result;
  score.source_errors = 0;
  score.job_errors = 0;
  score.label_errors = 0;
  score.proof_errors = 0;
  score.missing_proofs = 0;
  score.missing_reads = 0;
  score.source_fn = 0;
  score.job_fn = 0;
  score.target_fn = 0;
  score.operational_fn = 0;
  score.fn = 0;
  for (const [tokenId, native] of state.truth.source) {
    const prediction = result.sourceAlerts[tokenId];
    if (typeof prediction === 'boolean') {
      score.source_coverage += 1;
    }
    scoreBinaryAlert(score, native.alert, prediction, ['source']);
  }
  for (const [key, native] of state.truth.job) {
    const present = Object.hasOwn(result.jobAlerts, key);
    const prediction = result.jobAlerts[key];
    if (!present) {
      score.missing_reads += 1;
    } else if (typeof prediction === 'boolean') {
      score.read_coverage += 1;
    } else {
      score.unclassified_reads += 1;
    }
    scoreBinaryAlert(score, native.alert, prediction, ['job', native.role]);
    scorePerReadProof(score, native, result.proofs[key]);
  }
  const extraKeys = new Set([...Object.keys(result.jobAlerts), ...Object.keys(result.proofs)]);
  for (const key of extraKeys) {
    if (state.truth.job.has(key)) {
      continue;
    }
    score.unexpected_reads += 1;
    score.job_errors += 1;
    score.label_errors += 1;
    score.rule_errors += 1;
    if (result.jobAlerts[key] === true) {
      score.unexpected_read_alerts += 1;
      score.job_fp += 1;
      score.fp += 1;
    }
  }
  for (const tokenId of Object.keys(result.sourceAlerts)) {
    if (state.truth.source.has(tokenId)) {
      continue;
    }
    score.source_errors += 1;
    score.label_errors += 1;
    score.rule_errors += 1;
    if (result.sourceAlerts[tokenId] === true) {
      score.source_fp += 1;
      score.fp += 1;
    }
  }
  scoreExecutionErrors(score, result.errors);
  score.errors = score.label_errors + score.proof_errors + score.rule_errors;
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
