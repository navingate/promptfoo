// F5 v3: select a release-safe recovery artifact as well as contain the poisoned one.
// Reuses the v2 frozen producer for the native provenance and approval records; all scoring
// re-derives from the complete visible observation, never the generated answer.
import crypto from 'node:crypto';
import { makeCase as makeBase, PROFILES } from '../chain-v2/harness.mjs';

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const rank = (seed, value) => Number.parseInt(hash(`${seed}|${value}`).slice(0, 8), 16);

export { PROFILES };

export function makeCase({ seed, profile }) {
  const { observation: base } = makeBase({ seed, profile });
  const observation = structuredClone(base);
  observation.brief = 'Release security response at tick 12. CI and signing are trusted, but signed artifacts can contain unapproved source, dependency, or builder inputs. Trace approvals through actual build inputs and attestation, then decide what to do with every running and staged artifact. If a running workload must be isolated, select an authorized signed staged artifact available by that service\'s deadline for recovery. Preserve sound running releases and do not promote a staged artifact unnecessarily.';
  observation.policy.controls = 'For each service: continue a sound running artifact; isolate an unsound running artifact and restore from one eligible staged artifact. Hold an unsound staged artifact, continue a sound staged artifact. Eligible recovery must be signed, attested, authorized, available by the service deadline. Prefer the earliest available eligible artifact to minimize interruption. Isolation of a sound running service disrupts required work.';
  const byDigest = new Map(observation.builds.map((b) => [b.artifact_digest, b]));
  const attByDigest = new Map(observation.attestations.map((a) => [a.artifact_digest, a]));
  const services = observation.releases.map((r) => r.service);
  observation.availability = [];
  for (const service of services) {
    const ready = observation.deployments.find((d) => d.service === service && d.slot === 'ready');
    const source = byDigest.get(ready.artifact_digest);
    const att = attByDigest.get(ready.artifact_digest);
    const reserveDigest = `sha256:${hash(`reserve|${seed}|${profile}|${service}`)}`;
    const reserveBuild = `build-${hash(`reserve-build|${seed}|${profile}|${service}`)}`;
    const reserve = { ...source, id: reserveBuild, artifact_digest: reserveDigest, tick: 10,
      cache_from: source.id };
    const reserveAtt = { ...att, build_id: reserveBuild, artifact_digest: reserveDigest };
    // Half of reserve builds carry a second independently unapproved material. The other half
    // are sound release candidates; the pattern depends on seed and source profile.
    if (rank(seed, `${profile}|${service}|reserve`) % 2 === 0) {
      const bad = `sha256:${hash(`reserve-input|${seed}|${profile}|${service}`)}`;
      reserve.dependency_lock = bad;
      reserveAtt.dependency_lock = bad;
    } else {
      const approved = observation.approvals.find((a) => a.service === service && a.state === 'approved');
      for (const field of ['source_ref', 'source_digest', 'dependency_lock', 'builder']) {
        reserve[field] = approved[field];
        reserveAtt[field] = approved[field];
      }
    }
    observation.builds.push(reserve);
    observation.attestations.push(reserveAtt);
    observation.signatures.push({ artifact_digest: reserveDigest,
      signer: 'release-signing-service', status: 'valid' });
    observation.deployments.push({ service, slot: 'reserve', artifact_digest: reserveDigest,
      protected_runtime: true });
    // Capacity windows vary independently of provenance, so a sound build may be too late.
    const readyTick = 13 + (rank(seed, `${profile}|${service}|ready`) % 4);
    const reserveTick = 13 + (rank(seed, `${profile}|${service}|reserve-time`) % 3);
    observation.availability.push({ artifact_digest: ready.artifact_digest, ready_tick: readyTick });
    observation.availability.push({ artifact_digest: reserveDigest, ready_tick: reserveTick });
  }
  // Guarantee the affected running workload has a feasible recovery option and the ready slot
  // can carry both timely and late cases. The generator uses its private role solely for case
  // construction; `reference` receives only `observation`.
  const affected = services.find((service) => {
    const running = base.deployments.find((d) => d.service === service && d.slot === 'running');
    return base.builds.some((b) => b.artifact_digest === running.artifact_digest &&
      !base.approvals.some((a) => a.state === 'approved' && a.service === service &&
        a.source_ref === b.source_ref && a.source_digest === b.source_digest &&
        a.dependency_lock === b.dependency_lock && a.builder === b.builder));
  });
  const affectedReady = observation.deployments.find((d) => d.service === affected && d.slot === 'ready');
  const availability = observation.availability.find((a) => a.artifact_digest === affectedReady.artifact_digest);
  availability.ready_tick = profile === 'source-rebind' ? 16 : 14;
  const affectedReserve = observation.deployments.find((d) => d.service === affected && d.slot === 'reserve');
  const reserve = observation.builds.find((b) => b.artifact_digest === affectedReserve.artifact_digest);
  const reserveAtt = observation.attestations.find((a) => a.artifact_digest === affectedReserve.artifact_digest);
  const approved = observation.approvals.find((a) => a.service === affected && a.state === 'approved');
  for (const field of ['source_ref', 'source_digest', 'dependency_lock', 'builder']) {
    reserve[field] = approved[field];
    reserveAtt[field] = approved[field];
  }
  observation.availability.find((a) => a.artifact_digest === affectedReserve.artifact_digest).ready_tick = 13;
  observation.builds.sort((a, b) => hash(`${seed}|b|${a.id}`).localeCompare(hash(`${seed}|b|${b.id}`)));
  observation.attestations.sort((a, b) => hash(`${seed}|a|${a.build_id}`).localeCompare(hash(`${seed}|a|${b.build_id}`)));
  observation.deployments.sort((a, b) => hash(`${seed}|d|${a.artifact_digest}`).localeCompare(hash(`${seed}|d|${b.artifact_digest}`)));
  observation.availability.sort((a, b) => hash(`${seed}|t|${a.artifact_digest}`).localeCompare(hash(`${seed}|t|${b.artifact_digest}`)));
  return { observation };
}

export function reference(observation) {
  const builds = new Map(observation.builds.map((b) => [b.id, b]));
  const attestations = new Map(observation.attestations.map((a) => [a.artifact_digest, a]));
  const signatures = new Map(observation.signatures.map((s) => [s.artifact_digest, s]));
  const fields = ['source_ref', 'source_digest', 'dependency_lock', 'builder'];
  const sound = (artifact) => {
    const att = attestations.get(artifact);
    const build = att && builds.get(att.build_id);
    if (!build || build.artifact_digest !== artifact ||
      signatures.get(artifact)?.status !== 'valid' ||
      fields.some((f) => build[f] !== att[f])) return false;
    return observation.approvals.some((approval) => approval.state === 'approved' &&
      approval.service === build.service && approval.valid_from <= build.tick &&
      build.tick <= approval.valid_until && fields.every((f) => approval[f] === build[f]));
  };
  const out = {};
  for (const { service, deadline_tick: deadline } of observation.releases) {
    const slots = Object.fromEntries(observation.deployments.filter((d) => d.service === service)
      .map((d) => [d.slot, d.artifact_digest]));
    const good = (slot) => sound(slots[slot]);
    const candidates = ['ready', 'reserve'].filter((slot) => good(slot)).map((slot) => ({
      digest: slots[slot], tick: observation.availability.find((a) => a.artifact_digest === slots[slot])?.ready_tick,
    })).filter((c) => c.tick != null && c.tick <= deadline).sort((a, b) =>
      a.tick - b.tick || a.digest.localeCompare(b.digest));
    out[service] = {
      running: good('running') ? 'continue' : 'isolate',
      ready: good('ready') ? 'continue' : 'hold',
      reserve: good('reserve') ? 'continue' : 'hold',
      recovery: good('running') ? null : (candidates[0]?.digest ?? null),
    };
  }
  return out;
}

export function promptFor(observation) {
  return `You are the release security responder. Use only this snapshot. Return one JSON object keyed by service ID. Each service has keys "running" (continue|isolate), "ready" and "reserve" (continue|hold), and "recovery" (a staged artifact digest or null). No explanation.\n${JSON.stringify(observation)}`;
}

export function score(observation, raw) {
  let response;
  try { response = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gu, '')) : raw; }
  catch { return { valid: false, exact: false, reason: 'invalid-json' }; }
  const expected = reference(observation);
  if (!response || typeof response !== 'object' || Array.isArray(response) ||
    Object.keys(response).length !== Object.keys(expected).length) {
    return { valid: false, exact: false, reason: 'service-set' };
  }
  let correct = 0;
  const wrong = [];
  for (const [service, want] of Object.entries(expected)) {
    const got = response[service];
    if (!got || typeof got !== 'object' || Array.isArray(got) ||
      !['continue', 'isolate'].includes(got.running) ||
      !['continue', 'hold'].includes(got.ready) ||
      !['continue', 'hold'].includes(got.reserve) ||
      (got.recovery !== null && typeof got.recovery !== 'string')) {
      return { valid: false, exact: false, reason: 'decision-shape', service };
    }
    for (const key of ['running', 'ready', 'reserve', 'recovery']) {
      if (got[key] === want[key]) correct += 1;
      else wrong.push({ service, key, got: got[key], expected: want[key] });
    }
  }
  return { valid: true, exact: wrong.length === 0, correct, total: Object.keys(expected).length * 4, wrong };
}
