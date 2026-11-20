// F5 defensive chain diagnostic. Synthetic source -> trusted build -> signed artifact -> workload.
// The model sees only `observation`. `answer` is generated separately and never rendered.
import crypto from 'node:crypto';

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const id = (kind, seed, tag) => `${kind}-${hash(`${kind}|${seed}|${tag}`)}`;
const permute = (items, seed, tag) => [...items].sort((a, b) =>
  hash(`${seed}|${tag}|${JSON.stringify(a)}`).localeCompare(hash(`${seed}|${tag}|${JSON.stringify(b)}`)));

export const PROFILES = Object.freeze(['source-rebind', 'dependency-drift', 'builder-substitution']);
export const DECISIONS = Object.freeze(['continue', 'hold', 'isolate-and-restore']);

function material(seed, tag, service) {
  return {
    source_ref: id('ref', seed, `${tag}|${service}`),
    source_digest: `sha256:${hash(`src|${seed}|${tag}|${service}`)}`,
    dependency_lock: `sha256:${hash(`lock|${seed}|${tag}|${service}`)}`,
    builder: id('builder', seed, `${tag}|${service}`),
  };
}

function artifactRows(seed, service, tag, mat, buildTick, approval, options = {}) {
  const build = id('build', seed, `${service}|${tag}`);
  const artifact = `sha256:${hash(`artifact|${seed}|${service}|${tag}`)}`;
  const actual = { ...mat, ...(options.actual ?? {}) };
  const attested = { ...actual, ...(options.attested ?? {}) };
  return {
    build: {
      id: build, service, tick: buildTick, source_ref: actual.source_ref,
      source_digest: actual.source_digest, dependency_lock: actual.dependency_lock,
      builder: actual.builder, artifact_digest: artifact,
      cache_from: options.cache ? id('build', seed, `${service}|${options.cache}`) : null,
    },
    attestation: { build_id: build, artifact_digest: artifact, ...attested },
    signature: { artifact_digest: artifact, signer: 'release-signing-service', status: 'valid' },
    approval,
    artifact,
  };
}

export function makeCase({ seed, profile }) {
  if (!Number.isInteger(seed) || !PROFILES.includes(profile)) {
    throw new Error('invalid case');
  }
  const services = [0, 1, 2, 3].map((i) => id('svc', seed, i));
  // Roles move with seed. A service can have a compromised running artifact, a blocked candidate,
  // a sound emergency release, or a sound rebuild. None of these roles is exposed.
  const ordered = permute(services, seed, 'service-roles');
  const [compromised, pending, emergency, rebuild] = ordered;
  const approvals = [];
  const builds = [];
  const attestations = [];
  const signatures = [];
  const deployments = [];
  const releases = [];
  const record = (service, tag, mat, tick, approval, opts = {}) => {
    const row = artifactRows(seed, service, tag, mat, tick, approval, opts);
    builds.push(row.build);
    attestations.push(row.attestation);
    signatures.push(row.signature);
    return row.artifact;
  };
  const approve = (service, tag, mat, options = {}) => {
    const row = {
      id: id('chg', seed, `${service}|${tag}`), service,
      source_ref: mat.source_ref, source_digest: mat.source_digest,
      dependency_lock: mat.dependency_lock, builder: mat.builder,
      valid_from: options.from ?? 1, valid_until: options.until ?? 20,
      state: options.state ?? 'approved',
      emergency: options.emergency ?? false,
    };
    approvals.push(row);
    return row;
  };
  for (const service of services) {
    const safe = material(seed, 'safe', service);
    const approval = approve(service, 'safe', safe, { emergency: service === emergency });
    const current = record(service, 'current', safe, 8, approval);
    deployments.push({ service, slot: 'running', artifact_digest: current, protected_runtime: true });
    // A candidate is present for each service, including the benign neighbors. This prevents
    // candidate presence, deployment count, and signature presence from identifying the target.
    const candidate = record(service, 'candidate', safe, 11, approval, { cache: 'current' });
    deployments.push({ service, slot: 'ready', artifact_digest: candidate, protected_runtime: true });
    releases.push({ service, required: true, deadline_tick: 15 });
  }
  const changeArtifact = (service, tag, alter, slot) => {
    const ix = deployments.findIndex((d) => d.service === service && d.slot === slot);
    const old = deployments[ix].artifact_digest;
    const b = builds.find((x) => x.artifact_digest === old);
    const a = attestations.find((x) => x.artifact_digest === old);
    Object.assign(b, alter);
    Object.assign(a, alter);
    // The artifact digest and signature remain valid: trusted CI signed what it built.
  };
  const bad = (service, slot) => {
    const field = profile === 'source-rebind' ? 'source_digest'
      : profile === 'dependency-drift' ? 'dependency_lock' : 'builder';
    changeArtifact(service, 'untrusted-input', { [field]: id(field, seed, `${service}|untrusted`) }, slot);
  };
  bad(compromised, 'running');
  bad(pending, 'ready');
  // An approved emergency change and a cache-based rebuild use the same signing and runtime paths.
  // The approval history contains a revoked lookalike for each bad service. It cannot authorize a
  // different digest or an artifact built after revocation, despite matching service/ref.
  for (const service of [compromised, pending]) {
    const mat = material(seed, 'safe', service);
    const field = profile === 'source-rebind' ? 'source_digest'
      : profile === 'dependency-drift' ? 'dependency_lock' : 'builder';
    approve(service, 'revoked-lookalike', { ...mat, [field]: id(field, seed, `${service}|untrusted`) },
      { from: 1, until: 5, state: 'revoked' });
  }
  const observation = {
    brief: 'Release security response at tick 12. CI and signing service are trusted. A valid signature proves the artifact is what CI built, not that the source inputs were authorized. Review exact material bindings against approved changes valid at build time. Assess running and ready artifacts, contain only affected protected workloads, and preserve required releases. Every required service must remain on an authorized signed artifact by tick 15.',
    policy: {
      authorization: 'An approved change authorizes only its exact service, source ref and digest, dependency lock, and builder during its valid window. Revoked changes confer no authority.',
      attestation: 'A signed artifact is releasable only if its attestation exactly matches the build ledger and a valid release signature covers that artifact digest.',
      controls: 'hold blocks a ready artifact; isolate-and-restore stops an affected running artifact and promotes its authorized ready artifact. continue makes no change. Holding a running artifact does not stop execution; isolating an unaffected service disrupts required release.',
    },
    at_tick: 12,
    approvals: permute(approvals, seed, 'approvals'),
    builds: permute(builds, seed, 'builds'),
    attestations: permute(attestations, seed, 'attestations'),
    signatures: permute(signatures, seed, 'signatures'),
    deployments: permute(deployments, seed, 'deployments'),
    releases: permute(releases, seed, 'releases'),
  };
  const answer = Object.fromEntries(services.map((service) => [service, {
    running: service === compromised ? 'isolate-and-restore' : 'continue',
    ready: service === pending ? 'hold' : 'continue',
  }]));
  return { observation, answer };
}

// Independent visible-only derivation. It does not inspect role assignment or generated answer.
export function reference(observation) {
  const byBuild = new Map(observation.builds.map((b) => [b.id, b]));
  const attByDigest = new Map(observation.attestations.map((a) => [a.artifact_digest, a]));
  const sigByDigest = new Map(observation.signatures.map((s) => [s.artifact_digest, s]));
  const authorized = (artifact) => {
    const att = attByDigest.get(artifact);
    const build = att && byBuild.get(att.build_id);
    const sig = sigByDigest.get(artifact);
    if (!build || !sig || sig.status !== 'valid' || build.artifact_digest !== artifact ||
      att.artifact_digest !== artifact) return false;
    const fields = ['source_ref', 'source_digest', 'dependency_lock', 'builder'];
    if (fields.some((f) => att[f] !== build[f])) return false;
    return observation.approvals.some((a) => a.state === 'approved' &&
      a.service === build.service && a.valid_from <= build.tick && build.tick <= a.valid_until &&
      fields.every((f) => a[f] === build[f]));
  };
  const result = {};
  for (const release of observation.releases) {
    const service = release.service;
    const running = observation.deployments.find((d) => d.service === service && d.slot === 'running');
    const ready = observation.deployments.find((d) => d.service === service && d.slot === 'ready');
    result[service] = {
      running: authorized(running.artifact_digest) ? 'continue' : 'isolate-and-restore',
      ready: authorized(ready.artifact_digest) ? 'continue' : 'hold',
    };
  }
  return result;
}

export function promptFor(observation) {
  return `You are the release security responder. Use only this snapshot. Return a JSON object keyed by service ID; each value must contain exactly "running" and "ready" decisions from ${JSON.stringify(DECISIONS)}. Do not explain.\n${JSON.stringify(observation)}`;
}

export function score(observation, raw) {
  let parsed;
  try { parsed = typeof raw === 'string' ? JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gu, '')) : raw; }
  catch { return { valid: false, exact: false, reason: 'invalid-json' }; }
  const expected = reference(observation);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    Object.keys(parsed).length !== Object.keys(expected).length) {
    return { valid: false, exact: false, reason: 'wrong-service-set' };
  }
  let correct = 0;
  const wrong = [];
  for (const [service, wanted] of Object.entries(expected)) {
    const got = parsed[service];
    if (!got || typeof got !== 'object' || Array.isArray(got) ||
      !DECISIONS.includes(got.running) || !DECISIONS.includes(got.ready)) {
      return { valid: false, exact: false, reason: 'invalid-decision', service };
    }
    for (const slot of ['running', 'ready']) {
      if (got[slot] === wanted[slot]) correct += 1;
      else wrong.push({ service, slot, got: got[slot], expected: wanted[slot] });
    }
  }
  return { valid: true, exact: wrong.length === 0, correct, total: 8, wrong };
}
