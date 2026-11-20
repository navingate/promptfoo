// F5 v7 live release response: required work has explicit artifact fulfillment lineage.
// All source/build/approval/deployment facts are queryable; hidden truth is used only by the scorer.
import crypto from 'node:crypto';

const hash = (x) => crypto.createHash('sha256').update(String(x)).digest('hex').slice(0, 12);
const id = (kind, seed, tag) => `${kind}-${hash(`${kind}|${seed}|${tag}`)}`;
const digest = (seed, tag) => `sha256:${hash(`${seed}|${tag}`)}`;
const shuffled = (items, seed, tag) => [...items].sort((x, y) =>
  hash(`${seed}|${tag}|${x}`).localeCompare(hash(`${seed}|${tag}|${y}`)));
export const PROFILES = Object.freeze(['active-and-queued', 'queued-only', 'approved-emergency']);
export const CASE_SEEDS = Object.freeze([101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157]);
export const caseToken = (seed, profile) => `case-${hash(`f5-v6|${seed}|${profile}`)}`;
export function resolveCaseToken(value) {
  for (const seed of CASE_SEEDS) for (const profile of PROFILES) {
    if (caseToken(seed, profile) === value) return { seed, profile };
  }
  throw Error('unknown case token');
}

export function makeIncident({ seed, profile }) {
  if (!Number.isInteger(seed) || !PROFILES.includes(profile)) throw Error('invalid case');
  const [a, b, c] = shuffled([0, 1, 2].map((n) => id('service', seed, n)), seed, 'roles');
  const p = id('package', seed, 'suspect');
  const bWork = id('work', seed, 'b-required');
  const cWork = id('work', seed, 'c-required');
  const ref = id('ref', seed, 'shared-lib');
  const safeDigest = digest(seed, 'approved-lib');
  const suspiciousDigest = profile === 'approved-emergency'
    ? digest(seed, 'emergency-lib') : digest(seed, 'unapproved-lib');
  const approvals = [
    { id: id('change', seed, 'safe'), source_ref: ref, source_digest: safeDigest,
      services: [a, b, c], state: 'approved', valid_from: 0, valid_until: 3 },
    { id: id('change', seed, 'suspect-old'), source_ref: ref, source_digest: suspiciousDigest,
      services: [a, b, c], state: 'revoked', valid_from: 0, valid_until: 3,
      emergency: true },
    { id: id('change', seed, 'suspect-new'), source_ref: ref, source_digest: suspiciousDigest,
      services: [a, b, c], state: 'approved',
      valid_from: profile === 'approved-emergency' ? 0 : 2, valid_until: 3,
      emergency: true },
  ];
  const artifacts = [];
  const build = (service, tag, sourceDigest, packageDigest, readyTick = 0,
    fulfillsWork = null) => {
    const artifact = digest(seed, `${service}|${tag}|artifact`);
    const buildId = id('build', seed, `${service}|${tag}`);
    artifacts.push({ artifact_digest: artifact, build_id: buildId, service,
      build_tick: tag.includes('queued') || tag.includes('recovery') ? 1 : 0,
      source_ref: ref, source_digest: sourceDigest, package_digest: packageDigest,
      fulfills_work: fulfillsWork,
      builder: 'trusted-ci-builder', signature: 'valid',
      attestation: { build_id: buildId, source_ref: ref, source_digest: sourceDigest,
        package_digest: packageDigest, builder: 'trusted-ci-builder',
        fulfills_work: fulfillsWork },
      ready_tick: readyTick });
    return artifact;
  };
  const pkg = build('shared-package', 'suspect-package', suspiciousDigest, null);
  const safePkg = build('shared-package', 'safe-package', safeDigest, null);
  const aCurrent = build(a, 'current', safeDigest,
    profile === 'active-and-queued' ? pkg : safePkg);
  const aRecovery = build(a, 'recovery', safeDigest, safePkg);
  const bCurrent = build(b, 'current', safeDigest, safePkg);
  const bQueued = build(b, 'queued', safeDigest, pkg, 1, bWork);
  const bRecovery = build(b, 'recovery', safeDigest, safePkg, 1, bWork);
  const cCurrent = build(c, 'current', safeDigest, safePkg);
  const cQueued = build(c, 'queued-emergency', safeDigest, safePkg, 1, cWork);
  const services = shuffled([
    { id: a, current: aCurrent, staged: [aRecovery], auto_rollout: null,
      required_work: null, must_serve_continuously: true },
    { id: b, current: bCurrent, staged: [bQueued, bRecovery], auto_rollout: bQueued,
      required_work: bWork, release_deadline: 2, must_serve_continuously: true },
    { id: c, current: cCurrent, staged: [cQueued], auto_rollout: cQueued,
      required_work: cWork, release_deadline: 2, must_serve_continuously: true },
  ], seed, 'display');
  return {
    seed, profile, tick: 0, a, b, c,
    alert: { event: id('event', seed, 'source-intake'), source_ref: ref,
      source_digest: suspiciousDigest, package_artifact: pkg,
      message: 'Source intake changed on a package used by protected releases; CI signatures are valid. Verify authorization and consumers before release response.' },
    policy: {
      authorization: 'A package source is authorized for a consuming service only if an approved exact ref+digest change covers that service at build time. Revoked changes never authorize. All nested package inputs and build attestations must match actual inputs; all builders/signatures are trusted here.',
      timing: 'At advance to tick 1, unheld auto-rollout artifacts deploy. hold requests at tick 0 become effective before this rollout. Recovery staged artifacts are ready at their ready_tick. Running artifacts remain live after a new promotion until explicitly isolated. Do not create a service outage during containment. Each service with required_work must have a live authorized artifact whose signed fulfills_work exactly matches that work ID by tick 2. A held or unsafe scheduled artifact does not deliver work; a sound staged replacement with the same work ID does.',
      actions: 'Hold only unauthorized queued artifacts. Isolate only unauthorized running artifacts after promoting a sound recovery. Preserve approved emergency and scheduled releases.',
    },
    approvals, artifacts, services,
    live: new Map(services.map((service) => [service.id, new Set([service.current])])),
    held: new Set(), pendingHolds: new Set(), actionLog: [], collateral: 0,
    unsafeExecutions: 0, outages: 0, submitted: false,
  };
}

function artifactByDigest(estate, artifact) {
  return estate.artifacts.find((row) => row.artifact_digest === artifact);
}

// Visible-only soundness derivation; used by reference and replay scoring, never emitted as query output.
export function sound(estate, artifact, consumer, seen = new Set()) {
  if (seen.has(artifact)) return false;
  const row = artifactByDigest(estate, artifact);
  if (!row || row.signature !== 'valid' || row.builder !== 'trusted-ci-builder' ||
    row.attestation.build_id !== row.build_id ||
    row.attestation.source_ref !== row.source_ref ||
    row.attestation.source_digest !== row.source_digest ||
    row.attestation.package_digest !== row.package_digest ||
    row.attestation.builder !== row.builder ||
    row.attestation.fulfills_work !== row.fulfills_work) return false;
  const approved = estate.approvals.some((change) => change.state === 'approved' &&
    change.source_ref === row.source_ref && change.source_digest === row.source_digest &&
    change.services.includes(consumer) && change.valid_from <= row.build_tick &&
    change.valid_until >= row.build_tick);
  if (!approved) return false;
  return row.package_digest == null || sound(estate, row.package_digest, consumer,
    new Set(seen).add(artifact));
}

export function initial(estate) {
  return { alert: estate.alert, policy: estate.policy,
    tools: ['services', 'service', 'consumers', 'artifact', 'approvals', 'status',
      'hold', 'promote', 'isolate', 'advance', 'submit'],
    input: 'One JSON command per line. Queries: {op:"services"}, {op:"service",service}, {op:"consumers",artifact}, {op:"artifact",artifact}, {op:"approvals",source_ref}, {op:"status"}. Actions: {op:"hold",service,artifact}, {op:"promote",service,artifact}, {op:"isolate",service,artifact}, {op:"advance"}, {op:"submit"}. Submit after tick 2.' };
}

function checkContinuity(estate) {
  for (const service of estate.services) {
    const live = estate.live.get(service.id);
    if (![...live].some((artifact) => sound(estate, artifact, service.id))) estate.outages += 1;
  }
}

export function step(estate, command) {
  if (estate.submitted) return { error: 'already-submitted' };
  if (!command || typeof command !== 'object' || Array.isArray(command)) return { error: 'invalid-command' };
  const { op, service, artifact } = command;
  if (op === 'services') return { services: estate.services.map((s) => s.id) };
  if (op === 'service') {
    const row = estate.services.find((s) => s.id === service);
    return row ? { service: { ...row, live: [...estate.live.get(service)] } } : { error: 'unknown-service' };
  }
  if (op === 'consumers') return { consumers: estate.services.filter((s) =>
    [s.current, ...s.staged].some((candidate) => {
      const row = artifactByDigest(estate, candidate);
      return row?.package_digest === artifact;
    })).map((s) => ({ service: s.id, slots: [s.current, ...s.staged].filter((candidate) =>
      artifactByDigest(estate, candidate)?.package_digest === artifact) })) };
  if (op === 'artifact') return { artifact: artifactByDigest(estate, artifact) ?? null };
  if (op === 'approvals') return { approvals: estate.approvals.filter((row) => row.source_ref === command.source_ref) };
  if (op === 'status') return { tick: estate.tick, held: [...estate.held],
    pending_holds: [...estate.pendingHolds], live: Object.fromEntries([...estate.live].map(([k, v]) => [k, [...v]])) };
  const target = estate.services.find((s) => s.id === service);
  if (['hold', 'promote', 'isolate'].includes(op) && (!target || !artifact)) return { error: 'bad-target' };
  if (op === 'hold') {
    if (estate.tick !== 0 || target.auto_rollout !== artifact) return { error: 'hold-window-or-target' };
    estate.pendingHolds.add(artifact);
    if (sound(estate, artifact, service)) estate.collateral += 1;
    estate.actionLog.push(command);
    return { accepted: true, effective_at_tick: 1 };
  }
  if (op === 'promote') {
    const row = artifactByDigest(estate, artifact);
    if (!target.staged.includes(artifact) || !row || row.ready_tick > estate.tick ||
      estate.held.has(artifact) || estate.pendingHolds.has(artifact)) return { error: 'not-ready' };
    estate.live.get(service).add(artifact);
    if (!sound(estate, artifact, service)) estate.unsafeExecutions += 1;
    estate.actionLog.push(command);
    return { accepted: true, live: [...estate.live.get(service)] };
  }
  if (op === 'isolate') {
    if (!estate.live.get(service).has(artifact)) return { error: 'not-live' };
    if (sound(estate, artifact, service)) estate.collateral += 1;
    estate.live.get(service).delete(artifact);
    checkContinuity(estate);
    estate.actionLog.push(command);
    return { accepted: true, live: [...estate.live.get(service)] };
  }
  if (op === 'advance') {
    if (estate.tick >= 2) return { error: 'horizon' };
    estate.tick += 1;
    if (estate.tick === 1) {
      for (const artifact of estate.pendingHolds) estate.held.add(artifact);
      estate.pendingHolds.clear();
      for (const row of estate.services) {
        if (row.auto_rollout && !estate.held.has(row.auto_rollout)) {
          estate.live.get(row.id).add(row.auto_rollout);
          if (!sound(estate, row.auto_rollout, row.id)) estate.unsafeExecutions += 1;
        }
      }
    }
    for (const row of estate.services) for (const live of estate.live.get(row.id)) {
      if (!sound(estate, live, row.id)) estate.unsafeExecutions += 1;
    }
    checkContinuity(estate);
    estate.actionLog.push(command);
    return { tick: estate.tick, rollout_applied: estate.tick === 1 };
  }
  if (op === 'submit') {
    estate.submitted = true;
    const metrics = result(estate);
    return { submitted: true, score: metrics };
  }
  return { error: 'unknown-operation' };
}

export function result(estate) {
  const unsafeLive = estate.services.flatMap((s) => [...estate.live.get(s.id)]
    .filter((artifact) => !sound(estate, artifact, s.id)));
  const requiredMisses = estate.services.filter((s) => s.required_work &&
    ![...estate.live.get(s.id)].some((artifact) => {
      const row = artifactByDigest(estate, artifact);
      return row?.fulfills_work === s.required_work && sound(estate, artifact, s.id);
    }));
  const exact = estate.submitted && estate.tick === 2 && estate.collateral === 0 &&
    estate.unsafeExecutions === 0 && estate.outages === 0 && unsafeLive.length === 0 &&
    requiredMisses.length === 0;
  return { exact, tick: estate.tick, unsafe_executions: estate.unsafeExecutions,
    unsafe_live: unsafeLive.length, outages: estate.outages,
    collateral: estate.collateral, required_misses: requiredMisses.length,
    actions: estate.actionLog.length };
}

// Reference acts only through the same visible query surface and control commands.
export function visibleReference(estate) {
  const ids = step(estate, { op: 'services' }).services;
  const services = ids.map((service) => step(estate, { op: 'service', service }).service);
  const approvalCache = new Map();
  const visibleSound = (artifact, service, seen = new Set()) => {
    if (seen.has(artifact)) return false;
    const row = step(estate, { op: 'artifact', artifact }).artifact;
    if (!row || row.signature !== 'valid' || row.builder !== 'trusted-ci-builder' ||
      JSON.stringify(row.attestation) !== JSON.stringify({ build_id: row.build_id,
        source_ref: row.source_ref, source_digest: row.source_digest,
        package_digest: row.package_digest, builder: row.builder,
        fulfills_work: row.fulfills_work })) return false;
    if (!approvalCache.has(row.source_ref)) approvalCache.set(row.source_ref,
      step(estate, { op: 'approvals', source_ref: row.source_ref }).approvals);
    const allowed = approvalCache.get(row.source_ref).some((approval) =>
      approval.state === 'approved' && approval.source_digest === row.source_digest &&
      approval.services.includes(service) && approval.valid_from <= row.build_tick &&
      approval.valid_until >= row.build_tick);
    return allowed && (row.package_digest == null ||
      visibleSound(row.package_digest, service, new Set(seen).add(artifact)));
  };
  for (const s of services) {
    if (s.auto_rollout && !visibleSound(s.auto_rollout, s.id))
      step(estate, { op: 'hold', service: s.id, artifact: s.auto_rollout });
  }
  for (const s of services) {
    if (!visibleSound(s.current, s.id)) {
      const recovery = s.staged.find((artifact) => visibleSound(artifact, s.id) &&
        step(estate, { op: 'artifact', artifact }).artifact.ready_tick <=
          step(estate, { op: 'status' }).tick);
      if (!recovery) throw Error('reference has no immediate recovery');
      step(estate, { op: 'promote', service: s.id, artifact: recovery });
      step(estate, { op: 'isolate', service: s.id, artifact: s.current });
    }
  }
  step(estate, { op: 'advance' });
  for (const s of services) {
    const live = step(estate, { op: 'status' }).live[s.id];
    const delivered = live.some((artifact) =>
      step(estate, { op: 'artifact', artifact }).artifact.fulfills_work === s.required_work &&
      visibleSound(artifact, s.id));
    if (s.required_work && !delivered) {
      const recovery = s.staged.find((artifact) =>
        step(estate, { op: 'artifact', artifact }).artifact.fulfills_work === s.required_work &&
        visibleSound(artifact, s.id));
      if (!recovery) throw Error('reference has no release recovery');
      step(estate, { op: 'promote', service: s.id, artifact: recovery });
    }
  }
  step(estate, { op: 'advance' });
  return step(estate, { op: 'submit' }).score;
}
