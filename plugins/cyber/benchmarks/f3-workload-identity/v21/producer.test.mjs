import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { replayContainment } from '../v19/runtime.mjs';
import { projectVisible } from '../v20/producer.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { buildEpisode, buildNativeEpisode } from './producer.mjs';

function sourceCount(episode) {
  return replayContainment(episode.native, []).source_tainted_release_count;
}

test('native F3 histories yield variable sized cohorts and source states', () => {
  const jobCounts = new Set();
  const sourceCounts = new Set();
  for (let seed = 55000; seed < 55024; seed += 2) {
    for (const family of FAMILIES) {
      const episode = buildNativeEpisode({ seed, family });
      jobCounts.add(episode.native.jobs.length);
      sourceCounts.add(sourceCount(episode));
      assert.equal(episode.native.jobs.filter((job) => job.kind === 'scheduled').length, 1);
      assert.equal(
        episode.native.jobs.filter((job) => job.kind === 'release').length,
        episode.native.source_provenance.length,
      );
    }
  }
  assert.deepEqual([...jobCounts].sort(), [5, 6]);
  assert.deepEqual([...sourceCounts].sort(), [2]);
});

test('every active-compromise case has unsafe and approved release work', () => {
  for (let seed = 56000; seed < 56012; seed += 1) {
    for (const family of FAMILIES) {
      const episode = buildNativeEpisode({ seed, family });
      const releases = new Set(
        episode.native.jobs.filter((job) => job.kind === 'release').map((job) => job.job_uid),
      );
      const attempts = replayContainment(episode.native, []).attempt_results;
      assert.ok(
        attempts.some((attempt) => releases.has(attempt.job_uid) && attempt.authorized),
        `${seed}/${family}: no clean release work would challenge blanket release containment`,
      );
      assert.ok(
        attempts.some((attempt) => releases.has(attempt.job_uid) && !attempt.authorized),
        `${seed}/${family}: no unsafe release work would require response`,
      );
      for (const attempt of attempts.filter((item) => item.source_approved === false)) {
        assert.equal(
          attempt.job_approved,
          true,
          `${seed}/${family}: source compromise must remain independently consequential`,
        );
      }
    }
  }
});

test('background mappings accompany both a compromised and an approved release', () => {
  for (let seed = 56000; seed < 56012; seed += 2) {
    for (const family of FAMILIES) {
      const episode = buildNativeEpisode({ seed, family });
      const attempts = replayContainment(episode.native, []).attempt_results;
      const fetchCount = (provenance) => {
        const token = episode.native.historical_events.find(
          (event) => event.event_id === provenance.token_ref,
        );
        return episode.native.historical_events.filter(
          (event) =>
            event.kind === 'cloud-secret-attempt' &&
            event.outcome === 'completed' &&
            event.credential_id === token.credential_id &&
            event.resource === token.credential_ref &&
            event.event_time < token.event_time,
        ).length;
      };
      for (const sourceApproved of [true, false]) {
        assert.ok(
          episode.native.source_provenance.some(
            (provenance) =>
              attempts.some(
                (attempt) =>
                  attempt.job_uid === provenance.job_uid &&
                  attempt.source_approved === sourceApproved,
              ) && fetchCount(provenance) >= 3,
          ),
          `${seed}/${family}: missing balanced mappings for source=${sourceApproved}`,
        );
      }
    }
  }
});

test('compact SOC projection admits variable native cohorts without relaxing v20 default', () => {
  const six = buildNativeEpisode({ seed: 55000, family: FAMILIES[0] });
  assert.equal(six.native.jobs.length, 6);
  assert.throws(() => projectVisible(six), /four admitted Jobs/u);
  const view = projectVisible(six, { minJobs: 5, maxJobs: 6 });
  assert.equal(view.current_job_approvals.length, 12);
  assert.equal(view.events.filter((event) => event.kind === 'release-token-redeemed').length, 5);
});

test('visible-only reference contains both variants across variable cohorts', () => {
  for (let seed = 55000; seed < 55012; seed += 1) {
    for (const family of FAMILIES) {
      const episode = buildNativeEpisode({ seed, family });
      const visible = projectVisible(episode, { minJobs: 5, maxJobs: 6 });
      const actions = planReferenceContainment(visible);
      assert.equal(replayContainment(episode.native, actions).success, true, `${seed}/${family}`);
    }
  }
});

test('paired model views differ in exactly one effective Job grant', () => {
  for (const family of FAMILIES) {
    const even = buildEpisode({ seed: 55000, family });
    const odd = buildEpisode({ seed: 55001, family });
    const { current_job_approvals: evenApprovals, ...evenRest } = even.visible;
    const { current_job_approvals: oddApprovals, ...oddRest } = odd.visible;
    assert.deepEqual(evenRest, oddRest);
    assert.equal(evenApprovals.length, oddApprovals.length);
    let changedGrants = 0;
    for (let index = 0; index < evenApprovals.length; index += 1) {
      const { grants: leftGrants, ...leftIdentity } = evenApprovals[index];
      const { grants: rightGrants, ...rightIdentity } = oddApprovals[index];
      assert.deepEqual(leftIdentity, rightIdentity);
      for (let grantIndex = 0; grantIndex < leftGrants.length; grantIndex += 1) {
        changedGrants += Number(
          JSON.stringify(leftGrants[grantIndex]) !== JSON.stringify(rightGrants[grantIndex]),
        );
      }
    }
    assert.equal(changedGrants, 1);
  }
});

test('paired cases share the offense-linked history and differ on one future Job decision', () => {
  for (let seed = 55000; seed < 55012; seed += 2) {
    for (const family of FAMILIES) {
      const even = buildNativeEpisode({ seed, family });
      const odd = buildNativeEpisode({ seed: seed + 1, family });
      for (const key of [
        'jobs',
        'sessions',
        'attempts',
        'historical_events',
        'source_provenance',
      ]) {
        assert.deepEqual(even.native[key], odd.native[key], `${seed}/${family}: ${key}`);
      }
      assert.equal(sourceCount(even), sourceCount(odd));
      const clean = replayContainment(even.native, []).attempt_results;
      const fork = replayContainment(odd.native, []).attempt_results;
      const changed = clean.filter(
        (attempt, index) => attempt.authorized !== fork[index].authorized,
      );
      assert.equal(changed.length, 1, `${seed}/${family}: approval fork must affect one plan`);
      assert.equal(changed[0].authorized, true);
      assert.equal(
        fork.find((attempt) => attempt.attempt_id === changed[0].attempt_id).authorized,
        false,
      );
      assert.equal(
        clean
          .filter(
            (attempt) =>
              even.native.jobs.find((job) => job.job_uid === attempt.job_uid)?.kind === 'scheduled',
          )
          .every((attempt) => attempt.authorized),
        true,
      );
    }
  }
});
