// Cheap visible-only baselines; these must not solve the frozen investigation corpus.
import { authorizedByJoin } from '../shared/estate.mjs';

const target = 'malicious-missed-by-query';

function evaluate(name, episodes, keys, predict) {
  let exact = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let index = 0; index < episodes.length; index += 1) {
    const episode = episodes[index];
    const actual = new Set(
      Object.entries(keys[index].labels)
        .filter(([, label]) => label === target)
        .map(([id]) => id),
    );
    const predicted = new Set(predict(episode).map((grant) => grant.grant_id));
    const thisTp = [...predicted].filter((id) => actual.has(id)).length;
    const thisFp = [...predicted].filter((id) => !actual.has(id)).length;
    const thisFn = [...actual].filter((id) => !predicted.has(id)).length;
    tp += thisTp;
    fp += thisFp;
    fn += thisFn;
    exact += Number(thisFp === 0 && thisFn === 0);
  }
  return { name, exact, total: episodes.length, tp, fp, fn };
}

export function screenShortcuts(episodes, keys) {
  const baselines = [
    ['empty', () => []],
    [
      'all-post-reset-protected-calls',
      (episode) =>
        episode.grants.filter((grant) =>
          episode.events.some(
            (event) =>
              event.kind === 'protected-export-call' &&
              event.client_id === grant.client_id &&
              event.time > episode.remediation.reset_time,
          ),
        ),
    ],
    [
      'unrevoked-protected-call',
      (episode) =>
        episode.grants.filter(
          (grant) =>
            !episode.remediation.revoked_grant_ids.includes(grant.grant_id) &&
            episode.events.some(
              (event) =>
                event.kind === 'protected-export-call' && event.client_id === grant.client_id,
            ),
        ),
    ],
    ['first-grant', (episode) => episode.grants.slice(0, 1)],
    ['last-grant', (episode) => episode.grants.slice(-1)],
    [
      'no-client-named-approval',
      (episode) =>
        episode.grants.filter(
          (grant) =>
            !episode.registry.some((entry) => entry.client_or_app_selector === grant.client_id) &&
            episode.events.some(
              (event) =>
                event.kind === 'protected-export-call' && event.client_id === grant.client_id,
            ),
        ),
    ],
  ];
  baselines.push([
    'full-policy-join-plus-client-call-no-lineage',
    (episode) =>
      episode.grants.filter(
        (grant) =>
          !authorizedByJoin(grant, episode.registry, grant.issue_time) &&
          !episode.remediation.revoked_grant_ids.includes(grant.grant_id) &&
          episode.events.some(
            (event) =>
              event.kind === 'protected-export-call' &&
              event.client_id === grant.client_id &&
              event.time > episode.remediation.reset_time,
          ),
      ),
  ]);
  baselines.push([
    'full-policy-join-plus-client-count-shape',
    (episode) =>
      episode.grants.filter((grant) => {
        if (
          authorizedByJoin(grant, episode.registry, grant.issue_time) ||
          episode.remediation.revoked_grant_ids.includes(grant.grant_id)
        ) {
          return false;
        }
        const sameClient = episode.grants.filter((item) => item.client_id === grant.client_id);
        const calls = episode.events.filter(
          (event) =>
            event.kind === 'protected-export-call' &&
            event.client_id === grant.client_id &&
            event.time > episode.remediation.reset_time,
        );
        const tokens = episode.events.filter(
          (event) => event.kind === 'access-token-issued' && event.client_id === grant.client_id,
        );
        const distinctCauses = new Set(calls.map((call) => call.caused_by_event_id)).size;
        return sameClient.length === 2
          ? calls.length >= 2 && tokens.length >= 3 && distinctCauses >= 2
          : calls.length >= 1;
      }),
  ]);
  baselines.push([
    'full-policy-join-plus-call-lineage-no-token',
    (episode) =>
      episode.grants.filter(
        (grant) =>
          !authorizedByJoin(grant, episode.registry, grant.issue_time) &&
          !episode.remediation.revoked_grant_ids.includes(grant.grant_id) &&
          episode.events.some(
            (event) =>
              event.kind === 'protected-export-call' &&
              event.credential_lineage === grant.refresh_lineage &&
              event.time > episode.remediation.reset_time,
          ),
      ),
  ]);
  const rows = baselines.map(([name, predict]) => evaluate(name, episodes, keys, predict));
  for (const cutoff of [0, 1, 2, 3, 4, 5, 6]) {
    rows.push(
      evaluate(`client-registry-row-count<=${cutoff}`, episodes, keys, (episode) =>
        episode.grants.filter(
          (grant) =>
            episode.registry.filter(
              (entry) =>
                entry.client_or_app_selector === grant.client_id ||
                entry.client_or_app_selector === '*' ||
                (Array.isArray(entry.client_or_app_selector) &&
                  entry.client_or_app_selector.includes(grant.client_id)),
            ).length <= cutoff &&
            episode.events.some(
              (event) =>
                event.kind === 'protected-export-call' && event.client_id === grant.client_id,
            ),
        ),
      ),
    );
  }
  const prefix = (id) => id.split('_').at(-1)?.slice(0, 1);
  for (const character of '0123456789abcdef') {
    rows.push(
      evaluate(`grant-id-first-hex-${character}`, episodes, keys, (episode) =>
        episode.grants.filter((grant) => prefix(grant.grant_id) === character),
      ),
    );
  }
  return rows;
}
