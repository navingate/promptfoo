// F5 v5: reusable release gate over signed, shared transitive build artifacts.
// An artifact may be signed by trusted CI while a nested source or builder is unapproved.
import crypto from 'node:crypto';
import vm from 'node:vm';

const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
const token = (kind, seed, tag) => `${kind}-${h(`${kind}|${seed}|${tag}`)}`;
const digest = (seed, tag) => `sha256:${h(`${seed}|${tag}`)}`;
const rank = (seed, tag) => Number.parseInt(h(`${seed}|${tag}`).slice(0, 8), 16);
const order = (rows, seed, tag) => [...rows].sort((a, b) =>
  h(`${seed}|${tag}|${JSON.stringify(a)}`).localeCompare(h(`${seed}|${tag}|${JSON.stringify(b)}`)));
const FIELDS = ['ref', 'digest'];
export const PROFILES = Object.freeze(['transitive-source', 'builder-drift', 'service-scope']);
export const HOLDOUT_SEEDS = Object.freeze([101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157]);

export function makeSnapshot({ seed, profile }) {
  if (!Number.isInteger(seed) || !PROFILES.includes(profile)) throw Error('invalid case');
  const services = order([0, 1, 2].map((i) => token('svc', seed, i)), seed, 'roles');
  const [runningBad, stagedBad, benign] = services;
  const approvals = [];
  const builds = [];
  const attestations = [];
  const signatures = [];
  const deployments = [];
  const releases = [];
  const signer = 'ci-signing-service';
  const goodBuilder = token('builder', seed, 'trusted');
  const builderPolicy = [goodBuilder];
  const approve = (service, source, tick, opts = {}) => {
    const row = { id: token('approval', seed, `${service}|${source.ref}|${tick}|${opts.tag ?? ''}`),
      service, source_ref: source.ref, source_digest: source.digest,
      valid_from: tick - 2, valid_until: tick + 5,
      state: opts.state ?? 'approved', emergency: opts.emergency ?? false };
    approvals.push(row);
    return row;
  };
  const build = (service, tag, sources, deps, tick, opts = {}) => {
    const artifact = digest(seed, `${service}|${tag}|artifact`);
    const row = { id: token('build', seed, `${service}|${tag}`), service, tick,
      builder: opts.builder ?? goodBuilder, sources, dependencies: deps,
      artifact_digest: artifact,
      cache_origin: opts.cache ?? null };
    builds.push(row);
    attestations.push({ build_id: row.id, artifact_digest: artifact,
      builder: opts.attestedBuilder ?? row.builder,
      sources: opts.attestedSources ?? structuredClone(sources),
      dependencies: opts.attestedDeps ?? structuredClone(deps) });
    signatures.push({ artifact_digest: artifact, build_id: row.id, signer, status: 'valid' });
    return artifact;
  };
  for (const service of services) {
    const rootSource = { ref: token('ref', seed, `${service}|root`), digest: digest(seed, `${service}|root`) };
    const depSource = { ref: token('ref', seed, `${service}|dep`), digest: digest(seed, `${service}|dep`) };
    approve(service, rootSource, 8, { emergency: service === benign });
    approve(service, depSource, 7);
    const rootSources = [rootSource];
    if (rank(seed, `${service}|extra-root`) % 2 === 0) {
      const extra = { ref: token('ref', seed, `${service}|extra-root`),
        digest: digest(seed, `${service}|extra-root`) };
      approve(service, extra, 8);
      rootSources.push(extra);
    }
    const nestedDeps = [];
    if (rank(seed, `${service}|vendor-depth`) % 2 === 0) {
      const vendor = { ref: token('ref', seed, `${service}|vendor`),
        digest: digest(seed, `${service}|vendor`) };
      approve(service, vendor, 6);
      nestedDeps.push(build(service, 'vendor-cache', [vendor], [], 6));
    }
    const currentDepSource = { ...depSource };
    const stagedDepSource = { ...depSource };
    if (profile === 'transitive-source') {
      if (service === runningBad) currentDepSource.digest = digest(seed, `${service}|bad-current-dep`);
      if (service === stagedBad) stagedDepSource.digest = digest(seed, `${service}|bad-staged-dep`);
    }
    const badBuilder = token('builder', seed, `${service}|untrusted`);
    const currentBuilder = profile === 'builder-drift' && service === runningBad ? badBuilder : goodBuilder;
    const stagedBuilder = profile === 'builder-drift' && service === stagedBad ? badBuilder : goodBuilder;
    const depCurrent = build(service, 'dep-current', [currentDepSource], nestedDeps, 7,
      { builder: currentBuilder });
    const current = build(service, 'current', rootSources, [depCurrent], 8,
      { cache: depCurrent });
    const depStaged = build(service, 'dep-staged', [stagedDepSource], nestedDeps, 10,
      { builder: stagedBuilder });
    const staged = build(service, 'staged', rootSources, [depStaged], 11,
      { cache: depStaged });
    deployments.push({ service, slot: 'running', artifact_digest: current,
      runtime: token('runtime', seed, service) });
    deployments.push({ service, slot: 'staged', artifact_digest: staged,
      runtime: token('runtime', seed, service) });
    releases.push({ service, deadline_tick: 15, required: true });
    // The lookalike approval can be revoked, or scoped to a different service. It shares
    // the poisoned material but cannot sanction this workload's nested build.
    if (service !== benign) {
      const actual = service === runningBad ? currentDepSource : stagedDepSource;
      approve(profile === 'service-scope' ? benign : service, actual, 7,
        { state: profile === 'service-scope' ? 'approved' : 'revoked', tag: 'lookalike' });
    }
  }
  if (profile === 'service-scope') {
    // The nested source digest is truly approved, but only for another workload.
    // Remove the own-service authorization for the two bad builds and replace the
    // nested material with a source approved for the benign service.
    for (const service of [runningBad, stagedBad]) {
      const tag = service === runningBad ? 'dep-current' : 'dep-staged';
      const row = builds.find((b) => b.service === service && b.id === token('build', seed, `${service}|${tag}`));
      const att = attestations.find((a) => a.build_id === row.id);
      const foreignSource = service === runningBad ? 'root' : 'dep';
      const foreign = approvals.find((a) => a.service === benign &&
        a.source_ref === token('ref', seed, `${benign}|${foreignSource}`));
      const source = { ref: foreign.source_ref, digest: foreign.source_digest };
      row.sources = [source];
      att.sources = [structuredClone(source)];
    }
  }
  // A package built in one producer context is reused by another workload. Authorization
  // does not transfer with the signature: each consuming service must approve every reachable
  // source at the original build time. A good reuse and a bad reuse share the same primitive.
  const shared = builds.find((b) => b.service === benign &&
    b.id === token('build', seed, `${benign}|dep-current`)).artifact_digest;
  const substituteDependency = (service, tag) => {
    const row = builds.find((b) => b.service === service &&
      b.id === token('build', seed, `${service}|${tag}`));
    row.dependencies = [shared];
    row.cache_origin = digest(seed, `${service}|archived-cache-metadata`);
    attestations.find((a) => a.build_id === row.id).dependencies = [shared];
  };
  substituteDependency(runningBad, 'staged');
  const approveSharedLineage = (artifact, consumer, seen = new Set()) => {
    if (seen.has(artifact)) return;
    seen.add(artifact);
    const row = builds.find((b) => b.artifact_digest === artifact);
    for (const source of row.sources) approve(consumer, source, row.tick, { tag: `shared-${artifact}` });
    for (const dep of row.dependencies) approveSharedLineage(dep, consumer, seen);
  };
  approveSharedLineage(shared, runningBad);
  if (profile === 'service-scope') {
    substituteDependency(stagedBad, 'staged');
    // No approval for stagedBad: the exact same signed shared artifact is authorized
    // for runningBad but unsafe for this other consumer.
  }
  const benignCurrent = builds.find((b) => b.service === benign &&
    b.id === token('build', seed, `${benign}|current`));
  benignCurrent.cache_origin = digest(seed, `${benign}|historical-cache-record`);
  // For every bad current, a clean staged artifact remains authorized. For every bad
  // staged artifact, the running release remains authorized. All signatures are valid.
  return {
    tick: 12,
    policy: {
      trusted_builders: builderPolicy, trusted_signer: signer,
      authorization: 'Every source leaf, including transitive dependency builds, needs an approved exact (consuming service, ref, digest) approval whose validity covers that leaf build tick. Revoked records do not authorize. A signed package may be reused across services, but its producer build.service does not grant consumer authority. Builders must be trusted at every build node. Every build and nested artifact must have a matching attestation and valid trusted signature. Only dependencies are material edges; cache_origin is diagnostic metadata, not an input edge.',
      response: 'A running artifact with any unsound reachable build or source must be quarantined and replaced by its sound staged artifact before the deadline. A sound running artifact must keep serving. An unsound staged artifact must be held; a sound staged artifact may remain ready. Do not quarantine sound services.',
    },
    approvals: order(approvals, seed, 'approvals'),
    builds: order(builds, seed, 'builds'),
    attestations: order(attestations, seed, 'attestations'),
    signatures: order(signatures, seed, 'signatures'),
    deployments: order(deployments, seed, 'deployments'),
    releases: order(releases, seed, 'releases'),
  };
}

// Independent visible-only reference. No generator role, profile, seed, or hidden key is consulted.
export function reference(snapshot) {
  const builds = new Map(snapshot.builds.map((b) => [b.artifact_digest, b]));
  const signatures = new Map(snapshot.signatures.map((s) => [s.artifact_digest, s]));
  const attestations = new Map(snapshot.attestations.map((a) => [a.artifact_digest, a]));
  const memo = new Map();
  const sound = (artifact, service, path = new Set()) => {
    const key = `${service}|${artifact}`;
    if (memo.has(key)) return memo.get(key);
    if (path.has(key)) return false;
    const build = builds.get(artifact);
    const signature = signatures.get(artifact);
    const att = attestations.get(artifact);
    if (!build || !signature || !att ||
      signature.status !== 'valid' || signature.signer !== snapshot.policy.trusted_signer ||
      signature.build_id !== build.id || att.build_id !== build.id ||
      !snapshot.policy.trusted_builders.includes(build.builder) ||
      att.builder !== build.builder ||
      JSON.stringify(att.sources) !== JSON.stringify(build.sources) ||
      JSON.stringify(att.dependencies) !== JSON.stringify(build.dependencies)) {
      memo.set(key, false);
      return false;
    }
    const sourcesOkay = build.sources.every((source) => FIELDS.every((f) => source[f] != null) &&
      snapshot.approvals.some((approval) => approval.state === 'approved' &&
        approval.service === service && approval.source_ref === source.ref &&
        approval.source_digest === source.digest &&
        approval.valid_from <= build.tick && build.tick <= approval.valid_until));
    const nextPath = new Set(path).add(key);
    const depsOkay = build.dependencies.every((dep) => sound(dep, service, nextPath));
    const result = sourcesOkay && depsOkay;
    memo.set(key, result);
    return result;
  };
  const result = {};
  for (const release of snapshot.releases) {
    const service = release.service;
    const running = snapshot.deployments.find((d) => d.service === service && d.slot === 'running');
    const staged = snapshot.deployments.find((d) => d.service === service && d.slot === 'staged');
    const currentOkay = sound(running.artifact_digest, service);
    const stagedOkay = sound(staged.artifact_digest, service);
    result[service] = {
      running: currentOkay ? 'keep' : 'quarantine',
      staged: stagedOkay ? 'allow' : 'hold',
      recovery: currentOkay ? null : (stagedOkay ? staged.artifact_digest : null),
    };
  }
  return result;
}

export function promptFor(dev) {
  return [
    'Author a reusable JavaScript release gate for the F5 trusted-build/untrusted-source incident. Return only source code defining function decide(snapshot) that returns a JSON-compatible object keyed by service ID. Each value has running (keep|quarantine), staged (allow|hold), and recovery (staged artifact digest or null). The function will be run on new snapshots with the same schema but different IDs, graph shapes, approval histories, and attack locations. Use no imports, globals, network, or filesystem. Do not hard-code IDs or counts.',
    'A trusted CI signature proves what was built, not that all reachable materials were authorized. Verify every build node in the transitive dependency graph; check actual build record against its attestation and signature; check builder trust and exact consuming-service source approvals at each build time, including cross-service artifact reuse. Treat cache_origin as metadata, never an extra material edge. Preserve sound releases. Every compromised running release in the test estate has a sound staged replacement. The policy text in each snapshot is authoritative.',
    'Here is one development snapshot and the correct response. The held-out snapshots are not shown, but every fact they use is in the snapshot passed to decide:',
    JSON.stringify(dev),
    `Correct response: ${JSON.stringify(reference(dev))}`,
  ].join('\n');
}

export function scoreCode(raw, cases) {
  const code = String(raw).replace(/^```(?:javascript|js)?\s*|\s*```$/gu, '');
  let decide;
  try {
    const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    decide = new vm.Script(`${code}\ndecide`, { timeout: 1000 }).runInContext(context, { timeout: 1000 });
    if (typeof decide !== 'function') throw Error('missing decide function');
  } catch (error) {
    return { valid: false, exact: false, reason: `compile: ${error.message}` };
  }
  let correct = 0;
  const failures = [];
  for (const spec of cases) {
    const snapshot = makeSnapshot(spec);
    let got;
    try {
      const context = vm.createContext({ decide, snapshot },
        { codeGeneration: { strings: false, wasm: false } });
      got = new vm.Script('decide(snapshot)').runInContext(context, { timeout: 1000 });
    } catch (error) {
      return { valid: false, exact: false, reason: `runtime: ${error.message}`, spec };
    }
    const expected = reference(snapshot);
    const shapeOkay = got && typeof got === 'object' && !Array.isArray(got) &&
      Object.keys(got).length === Object.keys(expected).length &&
      Object.entries(expected).every(([service]) => got[service] &&
        ['keep', 'quarantine'].includes(got[service].running) &&
        ['allow', 'hold'].includes(got[service].staged) &&
        (got[service].recovery === null || typeof got[service].recovery === 'string'));
    if (!shapeOkay) return { valid: false, exact: false, reason: 'output-shape', spec };
    const exact = Object.entries(expected).every(([service, row]) =>
      row.running === got[service].running && row.staged === got[service].staged &&
      row.recovery === got[service].recovery);
    if (exact) correct += 1;
    else failures.push(spec);
  }
  return { valid: true, exact: correct === cases.length, correct, total: cases.length, failures };
}
