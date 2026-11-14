// Projected-table counterfactuals: built from validated native captures, then
// changed at the published SQL boundary to exercise facts fixed by native tools.
import { referenceLabels } from '../chain-v4/capture.mjs';
import { projectBatch } from '../chain-v9/project.mjs';
import {
  basePolicyAuthorizes,
  entryCovers,
  entryValidAt,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';

function oneCapture(batch, captureId) {
  const tables = projectBatch(batch);
  return Object.fromEntries(
    Object.entries(tables).map(([name, rows]) => [
      name,
      rows.filter((row) => row.capture_id === captureId),
    ]),
  );
}

function choose(batches, predicate) {
  for (const batch of batches) {
    const labels = referenceLabels(batch);
    const capture = batch.captures.find((item) => predicate(item, labels[item.grant.grant_id]));
    if (capture) {
      return { batch, capture };
    }
  }
  throw new Error('v10 projected control source missing');
}

function add(controls, id, source, transform, alert) {
  const tables = oneCapture(source.batch, source.capture.capture_id);
  transform(tables);
  controls.push({ id, tables, expected_alert_ids: alert ? [source.capture.grant.grant_id] : [] });
}

export function makeProjectedControls(batches) {
  const malicious = choose(batches, (_capture, label) => label === 'malicious-missed-by-query');
  const survivor = choose(
    batches,
    (capture, label) =>
      label === 'same-user-survivor' && capture.grant.grantor_type !== 'admin-consent',
  );
  const base = choose(
    batches,
    (capture, label) =>
      label === 'same-user-survivor' &&
      basePolicyAuthorizes(capture.grant) &&
      !capture.registry.some(
        (row) => entryCovers(row, capture.grant) && entryValidAt(row, capture.grant.issue_time),
      ),
  );
  const adminOutOfCatalog = choose(
    batches,
    (capture, label) =>
      label === 'same-user-survivor' &&
      capture.grant.grantor_type === 'admin-consent' &&
      !basePolicyAuthorizes(capture.grant) &&
      capture.grant.scopes.some((scope) => scope !== 'reports.export' && scope !== 'reports.read'),
  );
  const adminNearMiss = choose(
    batches,
    (capture, label) =>
      label === 'malicious-missed-by-query' &&
      capture.grant.grantor_type === 'admin-consent' &&
      capture.grant.approval_route === 'admin-approved',
  );
  const revoked = choose(batches, (_capture, label) => label === 'unauthorized-revoked');
  const controls = [];
  add(controls, 'native-malicious-causal-call', malicious, () => {}, true);
  add(controls, 'native-authorized-same-user', survivor, () => {}, false);
  add(controls, 'native-base-policy-only', base, () => {}, false);
  add(controls, 'native-already-revoked', revoked, () => {}, false);
  add(controls, 'native-admin-out-of-catalog-covered', adminOutOfCatalog, () => {}, false);
  add(controls, 'native-admin-out-of-catalog-near-miss', adminNearMiss, () => {}, true);
  add(
    controls,
    'missing-token-event',
    malicious,
    (tables) => {
      tables.events = tables.events.filter((row) => row.kind !== 'access-token-issued');
    },
    false,
  );
  add(
    controls,
    'broken-event-cause',
    malicious,
    (tables) => {
      tables.events.find((row) => row.kind === 'protected-export-call').caused_by_event_id =
        'unrelated-event';
    },
    false,
  );
  add(
    controls,
    'call-before-reset',
    malicious,
    (tables) => {
      tables.events.find((row) => row.kind === 'protected-export-call').time =
        tables.remediation[0].reset_time - 1;
    },
    false,
  );
  add(
    controls,
    'wrong-credential-lineage',
    malicious,
    (tables) => {
      tables.events.find((row) => row.kind === 'protected-export-call').credential_lineage =
        'unrelated-lineage';
    },
    false,
  );
  add(
    controls,
    'wrong-protected-resource',
    malicious,
    (tables) => {
      tables.events.find((row) => row.kind === 'protected-export-call').resource = 'reports.read';
    },
    false,
  );
  add(
    controls,
    'revoked-after-live-call',
    malicious,
    (tables) => {
      tables.revoked_grants.push({
        capture_id: tables.grants[0].capture_id,
        grant_id: tables.grants[0].grant_id,
      });
    },
    false,
  );
  add(
    controls,
    'missing-registry-selector',
    survivor,
    (tables) => {
      for (const row of tables.registry) {
        row.tenant_selector = 'null';
      }
    },
    true,
  );
  add(
    controls,
    'wrong-registry-scope',
    survivor,
    (tables) => {
      for (const row of tables.registry) {
        row.scope_selector = JSON.stringify(['reports.read']);
      }
    },
    true,
  );
  add(
    controls,
    'expired-at-issue-time',
    survivor,
    (tables) => {
      for (const row of tables.registry) {
        row.valid_until = tables.grants[0].issue_time - 1;
      }
    },
    true,
  );
  add(
    controls,
    'base-policy-removed',
    base,
    (tables) => {
      tables.base_policy = [];
      for (const row of tables.registry) {
        row.scope_selector = JSON.stringify(['reports.read']);
      }
    },
    true,
  );
  for (const control of controls) {
    if (
      control.tables.grants.length !== 1 ||
      control.expected_alert_ids.some((id) => id !== control.tables.grants[0].grant_id)
    ) {
      throw new Error(`invalid v10 projected control: ${control.id}`);
    }
    if (
      control.tables.events.some(
        (row) => row.kind === 'protected-export-call' && row.resource === PROTECTED_SCOPE,
      ) &&
      control.id === 'wrong-protected-resource'
    ) {
      throw new Error('wrong-resource control did not mutate call');
    }
  }
  return controls;
}
