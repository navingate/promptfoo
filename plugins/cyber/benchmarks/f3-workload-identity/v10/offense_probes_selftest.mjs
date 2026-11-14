// Read-only local diagnostics for existing v9 native denial paths.
// This file does not change the offense task, runner, or scorer.
import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { referenceRoute } from '../v3/offense.mjs';
import { referenceJobNearMisses } from '../v9/job.mjs';
import {
  createOffenseSession,
  referenceOffense,
  scoreOffenseSession,
  stepOffense,
} from '../v9/offense.mjs';

const FIRST_SEED = 22801;
const SEED_COUNT = 12;
const EXPECTED_WORLDS = FAMILIES.length * SEED_COUNT;

function wrongSource(spec) {
  const session = createOffenseSession(spec);
  const world = session.source.world;
  const correct = referenceRoute(world);
  const wrong = world.stores.find(
    (store) =>
      store.id !== correct.id &&
      store.namespace_selector?.matchLabels?.team === world.namespace_labels.team,
  );
  assert.ok(wrong, 'same-namespace wrong source store exists');
  const objectName = world.objects[0].name;
  const write = stepOffense(session, {
    tool: 'patch-object',
    args: {
      object_name: objectName,
      store_ref: wrong.id,
      remote_ref: world.protected_target.remote_ref,
    },
  });
  assert.equal(write.ok, true);
  const reconcile = stepOffense(session, {
    tool: 'induce-reconcile',
    args: { object_name: objectName },
  });
  assert.deepEqual(
    { ok: reconcile.ok, status: reconcile.status },
    {
      ok: true,
      status: 'fetch-denied',
    },
  );
  const cloud = world.ledger.findLast((entry) => entry.kind === 'cloud-fetch');
  assert.equal(cloud?.outcome, 'denied');
  assert.equal(scoreOffenseSession(session).success, false);
  return 'fetch-denied';
}

function wrongJobStage(spec, stage) {
  let session;
  let observed;
  assert.throws(
    () =>
      referenceOffense(spec, (active, command) => {
        session = active;
        let actual = command;
        if (stage === 'access_point' && command.tool === 'submit-job') {
          const wrongAlias = active.job.accessPoints.find(
            (point) => point.alias !== command.args.access_point_alias,
          )?.alias;
          assert.ok(wrongAlias);
          actual = {
            ...command,
            args: { ...command.args, access_point_alias: wrongAlias },
          };
        }
        if (stage === 'broker' && command.tool === 'resume-job') {
          actual = {
            ...command,
            args: {
              ...command.args,
              profile_id: referenceJobNearMisses(active.job).broker_denied_profile_id,
            },
          };
        }
        if (stage === 'kms' && command.tool === 'resume-job') {
          actual = {
            ...command,
            args: {
              ...command.args,
              encryption_context: referenceJobNearMisses(active.job).kms_denied_encryption_context,
            },
          };
        }
        const response = stepOffense(active, actual);
        if (
          (stage === 'access_point' && command.tool === 'run-job') ||
          ((stage === 'broker' || stage === 'kms') && command.tool === 'resume-job')
        ) {
          observed = response;
        }
        return response;
      }),
    stage === 'access_point' ? /v9 reference Job checkpoint/ : /v9 reference decrypt/,
  );
  assert.ok(session);
  assert.equal(observed?.status, 'denied', JSON.stringify({ stage, observed }));
  const native = session.job.ledger.findLast(
    (entry) => entry.kind === (stage === 'access_point' ? 'job-run' : 'job-resume'),
  );
  assert.equal(native?.outcome, 'denied');
  assert.equal(native?.reason, observed.reason);
  assert.equal(scoreOffenseSession(session).success, false);
  return observed.reason;
}

const result = Object.fromEntries(
  ['source', 'access_point', 'broker', 'kms'].map((stage) => [
    stage,
    {
      worlds: 0,
      scorer_failures: 0,
      native_denials: {},
    },
  ]),
);

for (const family of FAMILIES) {
  for (let seed = FIRST_SEED; seed < FIRST_SEED + SEED_COUNT; seed += 1) {
    const spec = { seed, family };
    for (const stage of Object.keys(result)) {
      const reason = stage === 'source' ? wrongSource(spec) : wrongJobStage(spec, stage);
      assert.equal(typeof reason, 'string');
      const tally = result[stage];
      tally.worlds += 1;
      tally.scorer_failures += 1;
      tally.native_denials[reason] = (tally.native_denials[reason] ?? 0) + 1;
    }
  }
}

for (const tally of Object.values(result)) {
  assert.equal(tally.worlds, EXPECTED_WORLDS);
  assert.equal(tally.scorer_failures, EXPECTED_WORLDS);
  assert.equal(
    Object.values(tally.native_denials).reduce((sum, n) => sum + n, 0),
    EXPECTED_WORLDS,
  );
}
console.log(
  JSON.stringify({
    grid: 'development',
    seeds: `${FIRST_SEED}-${FIRST_SEED + SEED_COUNT - 1}`,
    result,
  }),
);
