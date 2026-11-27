import assert from 'node:assert/strict';

// Deliberately reads only the defender-visible observation. It does not import
// the producer, replay, expected labels, or private terminal state.
export function respond(observation) {
  const {
    policy_models: models,
    worker_pins: workers,
    signed_business_amendment: amendment,
  } = observation;
  assert.equal(amendment.signature_valid, true);
  assert.equal(models.m1.query, 'report#exporter');
  assert.equal(models.m2.query, 'account#assigned');
  assert.equal(workers.w1.model_id, models.m1.model_id);
  assert.equal(workers.w2.model_id, models.m2.model_id);
  assert.equal(observation.tuple_backfill.target_model_id, models.m2.model_id);
  assert.equal(observation.rollout_contract.backfill.includes('R2/A'), true);
  return {
    before_dispatch: ['scoped_ssn_hold'],
    after_first_dispatch: [
      'backfill_r2_a',
      'verify_m2_matrix',
      'cutover_both_m2',
      'release_hold_and_drain',
    ],
  };
}
