import { produceObservation, replayCase } from './native.mjs';

export const SEED = 77001;
export const ARMS = ['receipt-before-cutoff', 'no-receipt-before-cutoff'];
export const MODES = [
  'v38-submitted-repair',
  'ordinary-composed-repair',
  'static-hold',
  'static-complete',
  'no-action',
];

const stableReceipt = (row) => ({
  receipt_id: row.receipt_id,
  request_id: row.request_id,
  job_id: row.job_id,
  recipient_id: row.recipient_id,
  stage_ref: row.stage_ref,
  report_ref: row.report_ref,
  cell_key: row.cell_key,
  value_sha256: row.value_sha256,
  accepted_at: row.accepted_at,
});

export async function screen() {
  const cases = {};
  for (const arm of ARMS) {
    cases[arm] = {};
    for (const mode of MODES) {
      const result = await replayCase(SEED, arm, mode);
      cases[arm][mode] = {
        initial_remote: result.initial.remote_sink.map(stableReceipt),
        initial_local: result.initial.local_request,
        action_error: result.action.error,
        terminal_remote: result.terminal.remote_sink.map(stableReceipt),
        terminal_local: result.terminal.requests,
        score: result.score,
        native: result.native,
      };
    }
  }
  return {
    schema_version: 'f10-v39-revocation-receipt-model-free-screen-v1',
    seed: SEED,
    matched_public_observation: produceObservation(SEED, ARMS[0]),
    private_arm_order: ARMS,
    cases,
  };
}
