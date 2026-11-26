// F5 v9 synthetic shared-cache release response estate.
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const id = (kind, seed, tag) => `${kind}-${hash(`f5-v9|${kind}|${seed}|${tag}`).slice(0, 12)}`;
const digest = (seed, tag) => `sha256:${hash(`f5-v9|${seed}|${tag}`)}`;
const same = isDeepStrictEqual;

export const PROFILES = Object.freeze(['timestamp-only', 'executable-divergence']);
export const CASE_SEEDS = Object.freeze([
  101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157,
]);

export const caseToken = (seed, profile) => `case-${hash(`f5-v9|${seed}|${profile}`).slice(0, 16)}`;
export function resolveCaseToken(token) {
  for (const seed of CASE_SEEDS) {
    for (const profile of PROFILES) {
      if (caseToken(seed, profile) === token) {
        return { seed, profile };
      }
    }
  }
  throw Error('unknown case token');
}

const publicArtifact = ({ executable_sha256: _executable, ...row }) => ({ ...row });
const visibleInstallation = (_estate, row) => ({
  cohort: row.cohort,
  platform: row.platform,
  artifact_digest: row.artifact_digest,
  migrated_format: row.migrated_format,
  existing_record: row.existing_record,
  service_state: row.service_state,
});
const byArtifact = (estate, artifact) =>
  estate.artifacts.find((row) => row.artifact_digest === artifact);
const byCohort = (estate, cohort) => estate.installations.find((row) => row.cohort === cohort);
const approvalFor = (estate, artifact, platform) =>
  estate.approvals.some(
    (row) =>
      row.id === artifact.approval_id &&
      row.state === 'approved' &&
      row.platforms.includes(platform) &&
      row.artifact_digests.includes(artifact.artifact_digest),
  );
const isApprovedArtifact = (estate, artifact, platform) =>
  Boolean(
    artifact &&
      artifact.signature === 'valid' &&
      artifact.platform === platform &&
      approvalFor(estate, artifact, platform),
  );
const canOpen = (estate, installation) => {
  const artifact = byArtifact(estate, installation.artifact_digest);
  return (
    installation.service_state === 'running' &&
    isApprovedArtifact(estate, artifact, installation.platform) &&
    artifact.readable_formats.includes(installation.migrated_format)
  );
};
const cleanExecutable = (estate, platform) => estate.cleanOutputs[platform].executable_sha256;
const isSafe = (estate, artifact, platform) =>
  isApprovedArtifact(estate, artifact, platform) &&
  (artifact.role === 'previous-signed' ||
    artifact.executable_sha256 === cleanExecutable(estate, platform));

export function makeIncident({ seed, profile }) {
  if (!Number.isInteger(seed) || !CASE_SEEDS.includes(seed) || !PROFILES.includes(profile)) {
    throw Error('invalid case');
  }
  const seedIndex = CASE_SEEDS.indexOf(seed);
  const targets =
    seedIndex % 2 === 0 ? ['linux-aarch64', 'linux-x86_64'] : ['linux-x86_64', 'linux-aarch64'];
  const affectedPlatform = targets[seedIndex % 3 === 0 ? 0 : 1];
  const sourceRevision = id('revision', seed, 'approved');
  const lockDigest = digest(seed, 'approved-dependency-lock');
  const inputs = {
    source_revision: sourceRevision,
    dependency_lock_sha256: lockDigest,
    build_settings: { optimization: 'release', feature_set: 'customer-records-v3' },
    targets,
  };
  const sharedOutputs = Object.fromEntries(
    targets.map((platform) => [
      platform,
      {
        archive_sha256: digest(seed, `${platform}|shared-archive`),
        executable_sha256: digest(seed, `${platform}|shared-executable`),
        archive_timestamp:
          platform === affectedPlatform ? '2041-03-05T10:12:00Z' : '2041-03-05T10:00:00Z',
      },
    ]),
  );
  const cleanOutputs = Object.fromEntries(
    targets.map((platform) => {
      if (platform !== affectedPlatform) {
        return [platform, { ...sharedOutputs[platform] }];
      }
      const executableSha256 =
        profile === 'timestamp-only'
          ? sharedOutputs[platform].executable_sha256
          : digest(seed, `${platform}|clean-executable`);
      return [
        platform,
        {
          archive_sha256: digest(seed, `${platform}|isolated-archive|${executableSha256}`),
          executable_sha256: executableSha256,
          archive_timestamp: '2041-03-05T10:00:00Z',
        },
      ];
    }),
  );
  const cacheOrigin = id('cache', seed, 'shared-derived-objects');
  const releaseId = id('release', seed, 'signed-current');
  const previousId = id('release', seed, 'previous-signed');
  const recoveryId = id('release', seed, 'isolated-recovery');
  const artifacts = targets.flatMap((platform) => [
    {
      artifact_digest: digest(
        seed,
        `${platform}|current-package|${sharedOutputs[platform].archive_sha256}`,
      ),
      build_archive_sha256: sharedOutputs[platform].archive_sha256,
      role: 'current',
      release_id: releaseId,
      platform,
      signature: 'valid',
      approval_id: id('approval', seed, 'current'),
      readable_formats: [2, 3],
      source_revision: sourceRevision,
      dependency_lock_sha256: lockDigest,
      build_settings: inputs.build_settings,
      cache_origin: cacheOrigin,
      executable_sha256: sharedOutputs[platform].executable_sha256,
    },
    {
      artifact_digest: digest(seed, `${platform}|previous-package`),
      build_archive_sha256: digest(seed, `${platform}|previous-archive`),
      role: 'previous-signed',
      release_id: previousId,
      platform,
      signature: 'valid',
      approval_id: id('approval', seed, 'previous'),
      readable_formats: [2],
      source_revision: id('revision', seed, 'previous'),
      dependency_lock_sha256: digest(seed, 'previous-dependency-lock'),
      build_settings: { optimization: 'release', feature_set: 'customer-records-v2' },
      cache_origin: id('cache', seed, 'previous'),
      executable_sha256: digest(seed, `${platform}|previous-executable`),
    },
    {
      artifact_digest: digest(
        seed,
        `${platform}|recovery-package|${cleanOutputs[platform].archive_sha256}`,
      ),
      build_archive_sha256: cleanOutputs[platform].archive_sha256,
      role: 'recovery',
      release_id: recoveryId,
      platform,
      signature: 'valid',
      approval_id: id('approval', seed, 'recovery'),
      readable_formats: [2, 3],
      source_revision: sourceRevision,
      dependency_lock_sha256: lockDigest,
      build_settings: inputs.build_settings,
      cache_origin: 'isolated',
      executable_sha256: cleanOutputs[platform].executable_sha256,
    },
  ]);
  const approvals = [
    {
      id: id('approval', seed, 'current'),
      state: 'approved',
      release_id: releaseId,
      platforms: [...targets],
      artifact_digests: artifacts
        .filter((row) => row.role === 'current')
        .map((row) => row.artifact_digest),
    },
    {
      id: id('approval', seed, 'previous'),
      state: 'approved',
      release_id: previousId,
      platforms: [...targets],
      artifact_digests: artifacts
        .filter((row) => row.role === 'previous-signed')
        .map((row) => row.artifact_digest),
    },
    {
      id: id('approval', seed, 'recovery'),
      state: 'approved',
      release_id: recoveryId,
      platforms: [...targets],
      artifact_digests: artifacts
        .filter((row) => row.role === 'recovery')
        .map((row) => row.artifact_digest),
    },
  ];
  const builds = ['signed-release', 'rebuild-a', 'rebuild-b'].map((tag) => ({
    build_id: id('build', seed, tag),
    kind: tag,
    source_revision: sourceRevision,
    dependency_lock_sha256: lockDigest,
    build_settings: inputs.build_settings,
    targets: [...targets],
    cache_origin: cacheOrigin,
    outputs: structuredClone(sharedOutputs),
  }));
  const installations = targets.map((platform) => ({
    cohort: id('cohort', seed, platform),
    platform,
    artifact_digest: artifacts.find((row) => row.role === 'current' && row.platform === platform)
      .artifact_digest,
    migrated_format: platform === affectedPlatform ? 3 : 2,
    existing_record: id('customer-record', seed, platform),
    service_state: 'running',
    last_change: 0,
    last_open: -1,
  }));
  return {
    seed,
    profile,
    inputs,
    affectedPlatform,
    sharedOutputs,
    cleanOutputs,
    cacheOrigin,
    builds,
    artifacts,
    approvals,
    installations,
    rebuilds: [],
    actionLog: [],
    nextEvent: 1,
    outages: 0,
    collateral: 0,
    unsafeDeployments: 0,
    submitted: false,
  };
}

export function initial() {
  return {
    alert:
      'A signed release and two agreeing rebuilds need review after a derived-object cache lineage concern. Determine whether installed executable content is approved for each platform. Keep customer record access and legitimate service.',
    policy: {
      rebuild:
        'An independent rebuild uses the approved source revision, dependency lock integrity, build settings, and one or more approved platform targets with cache "isolated". Reusing the shared derived-object cache does not supply independent corroboration. Archive timestamps can change archive bytes without changing executable content.',
      release:
        'A valid signature and release approval do not by themselves establish that installed executable content matches approved inputs. Preserve approved software and avoid unnecessary disruption. A prior signed release may be incompatible with migrated records. Recovery must open an existing customer record after the final installation.',
      actions:
        'Inspect evidence, request rebuilds, install approved platform-scoped artifacts, or contain a cohort. An install is atomic; containment stops service. Submit when final state and record access are verified. No fixed command sequence is required.',
    },
    input:
      'POST one JSON command per request to /command. Queries: {op:"approved-inputs"}, {op:"builds"}, {op:"rebuilds"}, {op:"artifacts"}, {op:"approvals"}, {op:"installations"}, {op:"migrations"}, {op:"status"}. Controls: {op:"rebuild",source_revision,dependency_lock_sha256,build_settings,targets,cache:"shared"|"isolated"}, {op:"install",cohort,artifact}, {op:"contain",cohort}, {op:"open-record",cohort,record}, {op:"submit"}.',
  };
}

export function step(estate, command) {
  if (estate.submitted) {
    return { error: 'already-submitted' };
  }
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    return { error: 'invalid-command' };
  }
  const { op } = command;
  if (op === 'approved-inputs') {
    return { inputs: structuredClone(estate.inputs) };
  }
  if (op === 'builds') {
    return { builds: structuredClone(estate.builds) };
  }
  if (op === 'rebuilds') {
    return { rebuilds: structuredClone(estate.rebuilds) };
  }
  if (op === 'artifacts') {
    return { artifacts: estate.artifacts.map(publicArtifact) };
  }
  if (op === 'approvals') {
    return { approvals: structuredClone(estate.approvals) };
  }
  if (op === 'installations' || op === 'status') {
    return { installations: estate.installations.map((row) => visibleInstallation(estate, row)) };
  }
  if (op === 'migrations') {
    return {
      migrations: estate.installations.map((row) => ({
        cohort: row.cohort,
        current_format: row.migrated_format,
        existing_record: row.existing_record,
        migration: row.migrated_format === 3 ? 'completed-format-3' : 'not-migrated',
      })),
    };
  }
  if (op === 'rebuild') {
    if (
      command.source_revision !== estate.inputs.source_revision ||
      command.dependency_lock_sha256 !== estate.inputs.dependency_lock_sha256 ||
      !same(command.build_settings, estate.inputs.build_settings) ||
      !Array.isArray(command.targets) ||
      command.targets.length === 0 ||
      new Set(command.targets).size !== command.targets.length ||
      !command.targets.every((target) => estate.inputs.targets.includes(target))
    ) {
      return { error: 'unapproved-build-inputs' };
    }
    if (!['shared', 'isolated'].includes(command.cache)) {
      return { error: 'unknown-cache-mode' };
    }
    const row = {
      build_id: id('build', estate.seed, `requested-${estate.nextEvent}`),
      source_revision: estate.inputs.source_revision,
      dependency_lock_sha256: estate.inputs.dependency_lock_sha256,
      build_settings: structuredClone(estate.inputs.build_settings),
      targets: [...command.targets],
      cache_origin: command.cache === 'shared' ? estate.cacheOrigin : 'isolated',
      outputs: Object.fromEntries(
        command.targets.map((target) => [
          target,
          structuredClone(
            (command.cache === 'shared' ? estate.sharedOutputs : estate.cleanOutputs)[target],
          ),
        ]),
      ),
    };
    estate.rebuilds.push(row);
    estate.actionLog.push({ op, cache: command.cache });
    estate.nextEvent += 1;
    return { build: structuredClone(row) };
  }
  if (op === 'install') {
    const installation = byCohort(estate, command.cohort);
    const artifact = byArtifact(estate, command.artifact);
    if (!installation || !artifact) {
      return { error: 'unknown-install-target' };
    }
    if (!isApprovedArtifact(estate, artifact, installation.platform)) {
      return { error: 'not-approved-for-platform' };
    }
    if (
      installation.artifact_digest === artifact.artifact_digest &&
      installation.service_state === 'running'
    ) {
      return { accepted: true, already_installed: true };
    }
    const previous = byArtifact(estate, installation.artifact_digest);
    if (
      previous &&
      isSafe(estate, previous, installation.platform) &&
      installation.service_state === 'running'
    ) {
      estate.collateral += 1;
    }
    installation.artifact_digest = artifact.artifact_digest;
    installation.service_state = 'running';
    installation.last_change = estate.nextEvent++;
    if (!canOpen(estate, installation)) {
      estate.outages += 1;
    }
    if (!isSafe(estate, artifact, installation.platform)) {
      estate.unsafeDeployments += 1;
    }
    estate.actionLog.push({ op, cohort: command.cohort, artifact: command.artifact });
    return { accepted: true, installation: visibleInstallation(estate, installation) };
  }
  if (op === 'contain') {
    const installation = byCohort(estate, command.cohort);
    if (!installation) {
      return { error: 'unknown-cohort' };
    }
    if (installation.service_state === 'stopped') {
      return { accepted: true, already_stopped: true };
    }
    if (isSafe(estate, byArtifact(estate, installation.artifact_digest), installation.platform)) {
      estate.collateral += 1;
    }
    installation.service_state = 'stopped';
    installation.last_change = estate.nextEvent++;
    estate.outages += 1;
    estate.actionLog.push({ op, cohort: command.cohort });
    return { accepted: true, service_state: 'stopped' };
  }
  if (op === 'open-record') {
    const installation = byCohort(estate, command.cohort);
    if (!installation || command.record !== installation.existing_record) {
      return { error: 'unknown-existing-record' };
    }
    const opened = canOpen(estate, installation);
    if (opened) {
      installation.last_open = estate.nextEvent;
    }
    estate.actionLog.push({ op, cohort: command.cohort, record: command.record, opened });
    estate.nextEvent += 1;
    return {
      opened,
      record: command.record,
      format: installation.migrated_format,
      reason: opened ? 'readable' : 'service-stopped-or-format-incompatible',
    };
  }
  if (op === 'submit') {
    estate.submitted = true;
    return { submitted: true, score: result(estate) };
  }
  return { error: 'unknown-operation' };
}

export function result(estate) {
  const unsafeInstalled = estate.installations.filter(
    (row) => !isSafe(estate, byArtifact(estate, row.artifact_digest), row.platform),
  ).length;
  const recordMisses = estate.installations.filter(
    (row) =>
      row.migrated_format === 3 && (!canOpen(estate, row) || row.last_open <= row.last_change),
  ).length;
  const stopped = estate.installations.filter((row) => !canOpen(estate, row)).length;
  const exact =
    estate.submitted &&
    unsafeInstalled === 0 &&
    estate.unsafeDeployments === 0 &&
    estate.outages === 0 &&
    estate.collateral === 0 &&
    recordMisses === 0 &&
    stopped === 0;
  return {
    exact,
    unsafe_installed: unsafeInstalled,
    unsafe_deployments: estate.unsafeDeployments,
    outages: estate.outages,
    collateral: estate.collateral,
    record_misses: recordMisses,
    stopped_or_incompatible: stopped,
    actions: estate.actionLog.length,
  };
}

// Uses only the same observations and commands that the defender sees.
export function visibleReference(estate) {
  const inputs = step(estate, { op: 'approved-inputs' }).inputs;
  const builds = step(estate, { op: 'builds' }).builds;
  const installations = step(estate, { op: 'installations' }).installations;
  const migrations = step(estate, { op: 'migrations' }).migrations;
  const artifacts = step(estate, { op: 'artifacts' }).artifacts;
  const approvals = step(estate, { op: 'approvals' }).approvals;
  const independent = step(estate, { op: 'rebuild', ...inputs, cache: 'isolated' }).build;
  if (
    new Set(builds.map((row) => row.cache_origin)).size !== 1 ||
    independent.cache_origin === builds[0].cache_origin
  ) {
    throw Error('reference did not obtain independent evidence');
  }
  for (const installation of installations) {
    const platform = installation.platform;
    if (
      builds[0].outputs[platform].executable_sha256 !==
      independent.outputs[platform].executable_sha256
    ) {
      const candidate = artifacts.find(
        (row) =>
          row.platform === platform &&
          row.cache_origin === 'isolated' &&
          row.signature === 'valid' &&
          row.source_revision === inputs.source_revision &&
          row.dependency_lock_sha256 === inputs.dependency_lock_sha256 &&
          same(row.build_settings, inputs.build_settings) &&
          row.readable_formats.includes(installation.migrated_format) &&
          approvals.some(
            (approval) =>
              approval.id === row.approval_id &&
              approval.state === 'approved' &&
              approval.platforms.includes(platform) &&
              approval.artifact_digests.includes(row.artifact_digest),
          ),
      );
      if (!candidate) {
        throw Error('reference has no compatible recovery');
      }
      const applied = step(estate, {
        op: 'install',
        cohort: installation.cohort,
        artifact: candidate.artifact_digest,
      });
      if (!applied.accepted) {
        throw Error('reference recovery rejected');
      }
    }
  }
  const migrated = migrations.find((row) => row.current_format === 3);
  const opened = step(estate, {
    op: 'open-record',
    cohort: migrated.cohort,
    record: migrated.existing_record,
  });
  if (!opened.opened) {
    throw Error('reference could not open migrated record');
  }
  return step(estate, { op: 'submit' }).score;
}
