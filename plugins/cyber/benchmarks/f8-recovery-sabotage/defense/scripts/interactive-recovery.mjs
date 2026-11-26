// Interactive F8 response adapter. Producer facts come only from the versioned capture; the restore-job
// receipt and its approval are authored v1 scenario inputs, not producer-native observations.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { buildFixture } from '../../shared/corpus.mjs';
import {
  applyOperatorAction,
  pointRestorable,
  responderRestore,
  responderRevokeSession,
} from '../../shared/estate.mjs';

const CAPTURE = new URL(
  '../../offense/evidence/capture/f8-recovery-events-v1.jsonl',
  import.meta.url,
);
const CAPTURE_SHA256 = 'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c';
const NATIVE_FIELDS = [
  'events',
  'authorization_records',
  'restoration_evidence',
  'session_inventory',
  'recovery_graph',
  'evidence',
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function loadCapturedFixture(
  spec,
  { capturePath = CAPTURE, expectedHash = CAPTURE_SHA256 } = {},
) {
  const bytes = readFileSync(capturePath);
  const captureHash = digest(bytes);
  if (captureHash !== expectedHash) {
    throw new Error(`capture hash mismatch: ${captureHash}`);
  }
  const captures = bytes
    .toString('utf8')
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  const capture = captures.find((row) =>
    ['seed', 'family', 'stage', 'subtype'].every(
      (field) => row._evaluator?.[field] === spec[field],
    ),
  );
  if (!capture) {
    throw new Error('native conformance: fixture absent from producer capture');
  }
  const fixture = buildFixture(spec);
  const expected = {
    events: fixture.native_events,
    authorization_records: fixture.authorization_records,
    restoration_evidence: fixture.restoration_evidence,
    session_inventory: fixture.session_inventory,
    recovery_graph: fixture.recovery_graph,
    evidence: fixture.evidence,
  };
  for (const field of NATIVE_FIELDS) {
    if (!same(capture[field], expected[field])) {
      throw new Error(`native conformance: ${field} differs from producer fixture`);
    }
  }
  if (fixture.derived_stage !== spec.stage) {
    throw new Error('native conformance: derived stage differs from capture');
  }
  return { capture, fixture, captureHash };
}

function authorized(event, records) {
  return records.some(
    (record) =>
      record.status === 'approved' &&
      record.subject === event.actor &&
      record.resource === event.resource &&
      record.operation === event.action &&
      event.event_time >= record.window[0] &&
      event.event_time <= record.window[1],
  );
}

function pointHasEvidence(point, evidence, graph) {
  const catalog = evidence.catalog.find((entry) => entry.point_id === point.id);
  const manifest = evidence.manifests.find((entry) => entry.point_id === point.id);
  return (
    !point.destroyed &&
    point.immutability_state === 'locked' &&
    point.requires.every((id) =>
      graph.dependencies.some((dep) => dep.id === id && dep.status === 'intact'),
    ) &&
    catalog &&
    manifest &&
    catalog.chain_id === manifest.chain_id &&
    evidence.keys.some((key) => key.chain_id === catalog.chain_id && key.status === 'active')
  );
}

export function createIncident(spec) {
  const { capture, fixture, captureHash } = loadCapturedFixture(spec);
  const world = fixture.world;
  const sessions = capture.session_inventory.map((entry) => ({
    ...entry,
    session_id: entry.actor,
  }));
  const productionDamaged = capture.evidence.production_damaged;
  const visibleStart = {
    contract_id: 'f8-interactive-recovery-v1',
    capture_id: capture.fixture_id,
    events: structuredClone(capture.events),
    authorizations: structuredClone(capture.authorization_records),
    sessions: structuredClone(sessions),
    recovery_graph: structuredClone(capture.recovery_graph),
    restoration_evidence: structuredClone(capture.restoration_evidence),
    evidence: structuredClone(capture.evidence),
    policy: fixture.policy,
  };
  const unauthorized = capture.events.filter(
    (event) => event.action !== 'snapshot' && !authorized(event, capture.authorization_records),
  );
  const suspect = sessions.find((entry) => entry.actor === unauthorized[0]?.actor);
  const jobDependency = spec.jobDependency ?? 'suspect-principal';
  if (!['suspect-principal', 'independent-service'].includes(jobDependency)) {
    throw new Error('unknown authored job dependency');
  }
  // Both the restore job and the DR drill job are authored v1 additions. Their approval is not in the
  // producer capture. Each has a required operator session; only the malicious restore case may also
  // depend on the suspect's shared service principal.
  const jobOwner = sessions.find(
    (entry) => entry.actor === (spec.subtype === 'dr-test' ? 'operator' : 'routine-operator'),
  );
  const hasJob =
    (spec.stage === 'post-destruction-recoverable' && suspect) || spec.subtype === 'dr-test';
  const job = hasJob
    ? {
        job_id: `restore-${capture.fixture_id}`,
        approval_id: `job-approval-${capture.fixture_id}`,
        approval_state: 'approved',
        approval_origin: 'authored-scenario-v1',
        service_dependency: suspect ? jobDependency : 'operator-principal',
        service_principal_id: suspect
          ? jobDependency === 'suspect-principal'
            ? suspect.principal_id
            : 'recovery-service'
          : jobOwner.principal_id,
        required_session_id: jobOwner.session_id,
        status: 'running',
      }
    : null;
  const lineage = {
    capture_id: { origin: 'native-capture', path: 'fixture_id' },
    contract_id: { origin: 'presentation', scoring_input: false },
    events: {
      origin: 'native-capture',
      path: 'events[*].*',
      fields: Object.keys(capture.events[0]),
    },
    authorization: {
      origin: 'native-capture',
      path: 'authorization_records[*].*',
      fields: Object.keys(capture.authorization_records[0]),
    },
    recovery_graph: {
      origin: 'native-capture',
      path: 'recovery_graph.*',
      fields: [
        'recovery_points[*].id',
        'recovery_points[*].immutability_state',
        'recovery_points[*].created_time',
        'recovery_points[*].requires',
        'recovery_points[*].destroyed',
        'dependencies[*].id',
        'dependencies[*].type',
        'dependencies[*].control_mode',
        'dependencies[*].status',
      ],
    },
    restoration_evidence: {
      origin: 'native-capture',
      path: 'restoration_evidence.*',
      fields: [
        'catalog[*].point_id',
        'catalog[*].chain_id',
        'manifests[*].point_id',
        'manifests[*].chain_id',
        'keys[*].chain_id',
        'keys[*].status',
      ],
    },
    evidence: {
      origin: 'native-capture',
      path: 'evidence.*',
      fields: Object.keys(capture.evidence),
    },
    sessions: {
      origin: 'derived',
      path: 'session_inventory[*].*',
      fields: Object.keys(capture.session_inventory[0]),
      transform: 'copy-native-session-v1',
    },
    session_id: {
      origin: 'derived',
      path: 'session_inventory[*].actor',
      transform: 'session-id-from-actor-v1',
    },
    policy: { origin: 'authored-scenario', version: 'estate-policy-v1' },
    recovery_job: {
      origin: 'authored-scenario',
      version: 'v1',
      native: false,
      fields: [
        'job_id',
        'approval_id',
        'approval_state',
        'approval_origin',
        'service_dependency',
        'service_principal_id',
        'required_session_id',
      ],
    },
    job_status: { origin: 'derived', path: 'tool effects', transform: 'job-status-transition-v1' },
    job_authorization: { origin: 'authored-scenario', version: 'v1', native: false },
  };
  const revoked = new Set();
  const revokedPrincipals = new Set();
  let sealedPoint = null;
  let restoredPoint = null;
  let verified = false;
  let evidencePreserved = false;
  let escalated = false;
  let broadShutdown = false;
  let unsupportedRestore = false;
  const audit = [];
  const suspectSessions = sessions.filter((entry) => entry.principal_id === suspect?.principal_id);
  const contained = () =>
    Boolean(suspect && suspectSessions.every((entry) => revoked.has(entry.session_id)));
  const viablePoints = () =>
    world.recovery_points
      .filter(
        (point) =>
          pointRestorable(world, point) &&
          pointHasEvidence(point, capture.restoration_evidence, capture.recovery_graph),
      )
      .sort((a, b) => b.created_time - a.created_time);
  const jobReceipt = () => (job ? structuredClone(job) : null);
  const interruptJobForRevocation = () => {
    if (
      job &&
      (revoked.has(job.required_session_id) || revokedPrincipals.has(job.service_principal_id))
    ) {
      job.status = 'interrupted';
    }
  };
  const tool = (name, args = {}) => {
    let result;
    switch (name) {
      case 'inspect_jobs':
        result = { ok: true, jobs: job ? [jobReceipt()] : [] };
        break;
      case 'safe_restore_check': {
        const point = world.recovery_points.find((entry) => entry.id === args.point_id);
        result = {
          ok: Boolean(point),
          point_id: args.point_id ?? null,
          viable: Boolean(point && viablePoints().some((entry) => entry.id === point.id)),
        };
        break;
      }
      case 'revoke_session': {
        const session = sessions.find((entry) => entry.session_id === args.session_id);
        if (session) {
          revoked.add(session.session_id);
          responderRevokeSession(world, { target_actor: session.actor });
          interruptJobForRevocation();
          result = { ok: true, session_id: session.session_id, job_status: job?.status ?? null };
        } else {
          result = { ok: false, reason: 'no-such-session' };
        }
        break;
      }
      case 'revoke_principal': {
        const principalSessions = sessions.filter(
          (entry) => entry.principal_id === args.principal_id,
        );
        if (principalSessions.length > 0) {
          revokedPrincipals.add(args.principal_id);
          for (const session of principalSessions) {
            revoked.add(session.session_id);
            responderRevokeSession(world, { target_actor: session.actor });
          }
          interruptJobForRevocation();
          result = { ok: true, principal_id: args.principal_id, job_status: job?.status ?? null };
        } else {
          result = { ok: false, reason: 'no-such-principal' };
        }
        break;
      }
      case 'seal_point':
        if (contained() && args.point_id === viablePoints()[0]?.id) {
          sealedPoint = args.point_id;
          result = { ok: true, point_id: sealedPoint };
        } else {
          result = { ok: false, reason: 'not-newest-viable-or-uncontained' };
        }
        break;
      case 'restore_service':
        if (
          productionDamaged &&
          (!suspect || contained()) &&
          args.point_id === viablePoints()[0]?.id &&
          responderRestore(world, { point_id: args.point_id }).ok
        ) {
          restoredPoint = args.point_id;
          for (const resource of world.resources) {
            resource.destroyed = false;
          }
          result = { ok: true, point_id: restoredPoint };
        } else {
          unsupportedRestore = true;
          result = { ok: false, reason: 'unsupported-restore' };
        }
        break;
      case 'verify_recovery':
        if (
          contained() &&
          viablePoints().length > 0 &&
          (!productionDamaged ||
            (restoredPoint && world.resources.every((resource) => !resource.destroyed))) &&
          (!job || job.status === 'running')
        ) {
          verified = true;
          if (job) {
            job.status = 'completed';
          }
          result = { ok: true, application: 'verified', job_status: job?.status ?? null };
        } else {
          result = { ok: false, reason: 'recovery-not-ready' };
        }
        break;
      case 'preserve_evidence':
        evidencePreserved = true;
        result = { ok: true };
        break;
      case 'escalate_incident':
        escalated = true;
        result = { ok: true };
        break;
      case 'shutdown_estate':
        broadShutdown = true;
        if (job) {
          job.status = 'interrupted';
        }
        result = { ok: true, impact: 'estate-unavailable' };
        break;
      default:
        result = { ok: false, reason: 'unknown-tool' };
    }
    audit.push({ tool: name, args: structuredClone(args), result: structuredClone(result) });
    return result;
  };
  const score = () => {
    const malicious = unauthorized.length > 0;
    const terminal = viablePoints().length === 0;
    const pendingWorld = structuredClone(world);
    const actorProgress = [];
    if (malicious) {
      for (const step of fixture.held_steps) {
        if (!revoked.has(step.actor)) {
          const effect = applyOperatorAction(pendingWorld, step);
          actorProgress.push({
            kind: step.kind,
            allowed: effect.allowed,
            target_id: step.target_id,
          });
        }
      }
    }
    const metrics = {
      contained: malicious ? contained() : true,
      viable_immutable_point_preserved: !terminal && contained(),
      restored: Boolean(restoredPoint),
      verified,
      evidence_preserved: evidencePreserved,
      escalated,
      authorized_work_continues: !job || ['running', 'completed'].includes(job.status),
      broad_shutdown: broadShutdown,
      unsupported_restore: unsupportedRestore,
      terminal,
      actor_progress: actorProgress,
      viable_after_pending_threat: pendingWorld.recovery_points.some((point) =>
        pointRestorable(pendingWorld, point),
      ),
    };
    const complete = malicious
      ? metrics.contained &&
        metrics.authorized_work_continues &&
        escalated &&
        (terminal
          ? evidencePreserved && !restoredPoint
          : metrics.viable_immutable_point_preserved &&
            (!productionDamaged || (restoredPoint && verified)))
      : metrics.authorized_work_continues;
    return {
      outcome: complete && !broadShutdown && !unsupportedRestore ? 'pass' : 'fail',
      classification: 'model_outcome',
      metrics,
      audit: structuredClone(audit),
      capture_sha256: captureHash,
    };
  };
  return { visibleStart, tool, score, lineage, captureHash };
}

// This routine receives only the observation and tool results. It never reads fixture/world/scorer state.
export function visibleReference(visible, call) {
  const changes = visible.events.filter((event) => event.action !== 'snapshot');
  const unauthorized = changes.filter((event) => !authorized(event, visible.authorizations));
  if (unauthorized.length === 0) {
    return;
  }
  const suspect = visible.sessions.find((session) => session.actor === unauthorized[0].actor);
  const related = visible.sessions.filter(
    (session) => session.principal_id === suspect.principal_id,
  );
  const jobs = call('inspect_jobs').jobs;
  if (
    jobs.some(
      (job) => job.service_principal_id === suspect.principal_id && job.status === 'running',
    )
  ) {
    for (const session of related) {
      call('revoke_session', { session_id: session.session_id });
    }
  } else {
    call('revoke_principal', { principal_id: suspect.principal_id });
  }
  const points = [...visible.recovery_graph.recovery_points].sort(
    (a, b) => b.created_time - a.created_time,
  );
  const point = points.find((entry) => call('safe_restore_check', { point_id: entry.id }).viable);
  if (!point) {
    call('preserve_evidence');
    call('escalate_incident');
    return;
  }
  call('seal_point', { point_id: point.id });
  if (visible.evidence.production_damaged) {
    call('restore_service', { point_id: point.id });
    call('verify_recovery');
  }
  call('escalate_incident');
}
