// Visible-only model-free comparison of direct placement and ordinary key-aware copying.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createProtectedCopyIncident } from './protected-copy.mjs';

export const CASE_ORDER = ['v22-shareable-rds', 'v22-managed-rds'];
const DESTINATION = 'recovery-account-vault';

function rehearseAndRestore(incident) {
  incident.tool('rehearse_source_outage');
  for (const datasetId of ['customer-objects', 'customer-ledger']) {
    incident.tool('restore_dataset', { dataset_id: datasetId });
    incident.tool('read_application', { dataset_id: datasetId });
  }
  incident.tool('read_unrelated_restore');
}

export function placementOnly(incident) {
  const visible = incident.tool('inspect_protection');
  for (const point of visible.source_points) {
    incident.tool('copy_to_destination', {
      dataset_id: point.dataset_id,
      point_id: point.point_id,
      destination_id: DESTINATION,
    });
  }
  rehearseAndRestore(incident);
}

export function visibleReference(incident) {
  const visible = incident.tool('inspect_protection');
  for (const point of visible.source_points) {
    let sourcePointId = point.point_id;
    if (
      visible.datasets.find((dataset) => dataset.dataset_id === point.dataset_id)
        .encryption_scope === 'resource-inherited' &&
      point.key.kind === 'source-default-managed'
    ) {
      const staged = incident.tool('stage_rewrapped_point', {
        dataset_id: point.dataset_id,
        point_id: point.point_id,
        key_ref: visible.copy_policy.approved_same_account_rewrap_key_ref,
      });
      if (!staged.ok) {
        throw new Error(`authorized source rewrap failed: ${staged.reason}`);
      }
      sourcePointId = staged.point_id;
    }
    const copied = incident.tool('copy_to_destination', {
      dataset_id: point.dataset_id,
      point_id: sourcePointId,
      destination_id: visible.copy_policy.approved_destination_id,
    });
    if (!copied.ok) {
      throw new Error(`authorized destination copy failed: ${copied.reason}`);
    }
  }
  rehearseAndRestore(incident);
}

export function ordinaryCopyProcedure(incident) {
  const state = incident.tool('inspect_protection');
  for (const point of state.source_points) {
    const request = {
      dataset_id: point.dataset_id,
      point_id: point.point_id,
      destination_id: state.copy_policy.approved_destination_id,
    };
    let copied = incident.tool('copy_to_destination', request);
    if (!copied.ok && copied.reason === 'nonshareable-source-resource-key') {
      const staged = incident.tool('stage_rewrapped_point', {
        dataset_id: point.dataset_id,
        point_id: point.point_id,
        key_ref: state.copy_policy.approved_same_account_rewrap_key_ref,
      });
      if (!staged.ok) {
        throw new Error(`source rewrap failed: ${staged.reason}`);
      }
      copied = incident.tool('copy_to_destination', { ...request, point_id: staged.point_id });
    }
    if (!copied.ok) {
      throw new Error(`destination copy failed: ${copied.reason}`);
    }
  }
  rehearseAndRestore(incident);
}

const POLICIES = { placementOnly, visibleReference, ordinaryCopyProcedure };

export function runProtectedCopyScreen() {
  return {
    contract_id: 'f8-v22-protected-copy-model-free-v1',
    case_order: CASE_ORDER,
    policies: Object.fromEntries(
      Object.entries(POLICIES).map(([name, procedure]) => [
        name,
        CASE_ORDER.map((caseId) => {
          const incident = createProtectedCopyIncident(caseId);
          procedure(incident);
          return { visible_start: incident.visibleStart, ...incident.score() };
        }),
      ]),
    ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node protected-copy-screen.mjs --write');
  }
  writeFileSync(
    new URL('../calibration/f8-v22-protected-copy-screen.json', import.meta.url),
    `${JSON.stringify(runProtectedCopyScreen(), null, 2)}\n`,
  );
}
