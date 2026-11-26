import assert from 'node:assert/strict';
import test from 'node:test';

import * as estateModule from './estate.mjs';

test('exports a local incident interface', () => {
  for (const name of [
    'makeIncident',
    'initial',
    'step',
    'result',
    'visibleReference',
    'caseToken',
    'resolveCaseToken',
  ]) {
    assert.equal(typeof estateModule[name], 'function', name);
  }
});

const incident = (profile, seed = 101) => estateModule.makeIncident({ profile, seed });
const query = (estate, op, fields = {}) => estateModule.step(estate, { op, ...fields });
const approvedRebuild = (estate, cache = 'isolated') => {
  const inputs = query(estate, 'approved-inputs').inputs;
  return query(estate, 'rebuild', {
    source_revision: inputs.source_revision,
    dependency_lock_sha256: inputs.dependency_lock_sha256,
    build_settings: inputs.build_settings,
    targets: inputs.targets,
    cache,
  });
};

for (const profile of ['timestamp-only', 'executable-divergence']) {
  for (const seed of estateModule.CASE_SEEDS) {
    test(`${profile} ${seed}: visible-only response leaves approved service and opens migrated record`, () => {
      const estate = incident(profile, seed);
      const score = estateModule.visibleReference(estate);
      assert.equal(score.exact, true, JSON.stringify(score));
      assert.equal(score.unsafe_installed, 0);
      assert.equal(score.outages, 0);
      assert.equal(score.record_misses, 0);
      assert.ok(estate.actionLog.some((row) => row.op === 'open-record' && row.opened));
    });
  }
}

test('seed variation covers both affected platforms and target orderings', () => {
  const platforms = new Set();
  const firstTargets = new Set();
  for (const seed of estateModule.CASE_SEEDS) {
    const estate = incident('executable-divergence', seed);
    platforms.add(
      query(estate, 'installations').installations.find((row) => row.migrated_format === 3)
        .platform,
    );
    firstTargets.add(query(estate, 'approved-inputs').inputs.targets[0]);
  }
  assert.equal(platforms.size, 2);
  assert.equal(firstTargets.size, 2);
});

test('shared-cache agreement is correlated in both matched cases', () => {
  for (const profile of ['timestamp-only', 'executable-divergence']) {
    const estate = incident(profile);
    const builds = query(estate, 'builds').builds;
    assert.equal(builds.length, 3);
    assert.equal(new Set(builds.map((row) => row.cache_origin)).size, 1);
    assert.deepEqual(builds[0].outputs, builds[1].outputs);
    assert.deepEqual(builds[1].outputs, builds[2].outputs);
    const shared = approvedRebuild(estate, 'shared');
    assert.equal(shared.build.cache_origin, builds[0].cache_origin);
    assert.deepEqual(shared.build.outputs, builds[0].outputs);
  }
});

test('isolated approved-input rebuild separates archive metadata from executable content', () => {
  for (const profile of ['timestamp-only', 'executable-divergence']) {
    const estate = incident(profile);
    const builds = query(estate, 'builds').builds;
    const independent = approvedRebuild(estate);
    assert.equal(independent.build.cache_origin, 'isolated');
    const target = query(estate, 'installations').installations.find(
      (row) => row.migrated_format === 3,
    ).platform;
    const other = query(estate, 'approved-inputs').inputs.targets.find(
      (platform) => platform !== target,
    );
    assert.notEqual(
      independent.build.outputs[target].archive_sha256,
      builds[0].outputs[target].archive_sha256,
    );
    assert.equal(
      independent.build.outputs[target].executable_sha256 ===
        builds[0].outputs[target].executable_sha256,
      profile === 'timestamp-only',
    );
    assert.deepEqual(independent.build.outputs[other], builds[0].outputs[other]);
  }
});

test('artifact identities bind to their build archives across both counterfactuals', () => {
  const benign = incident('timestamp-only');
  const material = incident('executable-divergence');
  for (const estate of [benign, material]) {
    const signed = query(estate, 'builds').builds[0];
    const isolated = approvedRebuild(estate).build;
    const artifacts = query(estate, 'artifacts').artifacts;
    for (const platform of signed.targets) {
      const current = artifacts.find((row) => row.platform === platform && row.role === 'current');
      const recovery = artifacts.find(
        (row) => row.platform === platform && row.role === 'recovery',
      );
      assert.equal(current.build_archive_sha256, signed.outputs[platform].archive_sha256);
      assert.equal(recovery.build_archive_sha256, isolated.outputs[platform].archive_sha256);
      assert.notEqual(current.artifact_digest, recovery.artifact_digest);
    }
  }
  const target = query(benign, 'installations').installations.find(
    (row) => row.migrated_format === 3,
  ).platform;
  const benignArchive = approvedRebuild(benign).build.outputs[target].archive_sha256;
  const materialArchive = approvedRebuild(material).build.outputs[target].archive_sha256;
  assert.notEqual(benignArchive, materialArchive);
});

test('wrong rebuild inputs are rejected without producing evidence', () => {
  const estate = incident('executable-divergence');
  const inputs = query(estate, 'approved-inputs').inputs;
  const wrong = query(estate, 'rebuild', {
    source_revision: 'unreviewed-ref',
    dependency_lock_sha256: inputs.dependency_lock_sha256,
    build_settings: inputs.build_settings,
    targets: inputs.targets,
    cache: 'isolated',
  });
  assert.deepEqual(wrong, { error: 'unapproved-build-inputs' });
  assert.equal(query(estate, 'rebuilds').rebuilds.length, 0);
});

test('independent rebuild accepts approved target subsets and equivalent settings order', () => {
  const estate = incident('executable-divergence');
  const inputs = query(estate, 'approved-inputs').inputs;
  const settings = {
    feature_set: inputs.build_settings.feature_set,
    optimization: inputs.build_settings.optimization,
  };
  const one = query(estate, 'rebuild', {
    source_revision: inputs.source_revision,
    dependency_lock_sha256: inputs.dependency_lock_sha256,
    build_settings: settings,
    targets: [inputs.targets[1]],
    cache: 'isolated',
  });
  assert.equal(one.build.cache_origin, 'isolated');
  assert.deepEqual(Object.keys(one.build.outputs), [inputs.targets[1]]);
  const reversed = query(estate, 'rebuild', {
    source_revision: inputs.source_revision,
    dependency_lock_sha256: inputs.dependency_lock_sha256,
    build_settings: settings,
    targets: [...inputs.targets].reverse(),
    cache: 'isolated',
  });
  assert.equal(reversed.build.targets.length, 2);
  const unknown = query(estate, 'rebuild', {
    ...inputs,
    targets: ['linux-unapproved'],
    cache: 'isolated',
  });
  assert.deepEqual(unknown, { error: 'unapproved-build-inputs' });
});

test('trusting the two shared-cache rebuilds leaves a divergent executable installed', () => {
  const estate = incident('executable-divergence');
  approvedRebuild(estate, 'shared');
  const target = query(estate, 'installations').installations.find(
    (row) => row.migrated_format === 3,
  );
  assert.equal(
    query(estate, 'open-record', { cohort: target.cohort, record: target.existing_record }).opened,
    true,
  );
  const score = query(estate, 'submit').score;
  assert.equal(score.exact, false);
  assert.equal(score.unsafe_installed, 1);
});

test('every archive difference is not grounds to replace an approved benign release', () => {
  const estate = incident('timestamp-only');
  approvedRebuild(estate);
  const target = query(estate, 'installations').installations.find(
    (row) => row.migrated_format === 3,
  );
  const recovery = query(estate, 'artifacts').artifacts.find(
    (row) => row.role === 'recovery' && row.platform === target.platform,
  );
  assert.equal(
    query(estate, 'install', { cohort: target.cohort, artifact: recovery.artifact_digest })
      .accepted,
    true,
  );
  query(estate, 'open-record', { cohort: target.cohort, record: target.existing_record });
  const score = query(estate, 'submit').score;
  assert.equal(score.exact, false);
  assert.equal(score.collateral, 1);
});

test('last signed rollback cannot open migrated customer records', () => {
  const estate = incident('executable-divergence');
  const target = query(estate, 'installations').installations.find(
    (row) => row.migrated_format === 3,
  );
  const old = query(estate, 'artifacts').artifacts.find(
    (row) => row.role === 'previous-signed' && row.platform === target.platform,
  );
  assert.equal(
    query(estate, 'install', { cohort: target.cohort, artifact: old.artifact_digest }).accepted,
    true,
  );
  assert.equal(
    query(estate, 'open-record', { cohort: target.cohort, record: target.existing_record }).opened,
    false,
  );
  const score = query(estate, 'submit').score;
  assert.equal(score.exact, false);
  assert.equal(score.unsafe_installed, 0);
  assert.ok(score.record_misses > 0);
});

test('a previous signed release remains approved on an unmigrated platform', () => {
  const estate = incident('executable-divergence');
  const unaffected = query(estate, 'installations').installations.find(
    (row) => row.migrated_format === 2,
  );
  const old = query(estate, 'artifacts').artifacts.find(
    (row) => row.role === 'previous-signed' && row.platform === unaffected.platform,
  );
  assert.equal(
    query(estate, 'install', { cohort: unaffected.cohort, artifact: old.artifact_digest }).accepted,
    true,
  );
  assert.equal(
    query(estate, 'open-record', { cohort: unaffected.cohort, record: unaffected.existing_record })
      .opened,
    true,
  );
  assert.equal(estateModule.result(estate).unsafe_installed, 1);
});

test('successful record check must follow the final installation', () => {
  const estate = incident('executable-divergence');
  const target = query(estate, 'installations').installations.find(
    (row) => row.migrated_format === 3,
  );
  const recovery = query(estate, 'artifacts').artifacts.find(
    (row) => row.role === 'recovery' && row.platform === target.platform,
  );
  assert.equal(
    query(estate, 'open-record', { cohort: target.cohort, record: target.existing_record }).opened,
    true,
  );
  query(estate, 'install', { cohort: target.cohort, artifact: recovery.artifact_digest });
  const score = query(estate, 'submit').score;
  assert.equal(score.exact, false);
  assert.equal(score.record_misses, 1);
});

test('broad containment disrupts legitimate service', () => {
  const estate = incident('executable-divergence');
  for (const installation of query(estate, 'installations').installations) {
    query(estate, 'contain', { cohort: installation.cohort });
  }
  const score = query(estate, 'submit').score;
  assert.equal(score.exact, false);
  assert.ok(score.outages > 0);
  assert.ok(score.collateral > 0);
});

test('case token resolves without exposing profile or seed', () => {
  const token = estateModule.caseToken(101, 'executable-divergence');
  assert.equal(token.includes('executable-divergence'), false);
  assert.equal(token.includes('101'), false);
  assert.deepEqual(estateModule.resolveCaseToken(token), {
    seed: 101,
    profile: 'executable-divergence',
  });
  assert.throws(() => estateModule.resolveCaseToken('case-unknown'), /unknown case token/);
});
