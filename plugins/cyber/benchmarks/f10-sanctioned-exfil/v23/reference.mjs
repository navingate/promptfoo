// Ordinary visible-only responder procedure; it does not import the native producer or its proof.
import assert from 'node:assert/strict';

export function respond(observation) {
  const receipts = new Map(
    observation.sink_receipts.map((receipt) => [receipt.stage_ref, receipt]),
  );
  const jobById = new Map(observation.job_registry.map((job) => [job.job_id, job]));
  const holdStageRefs = [];
  const exposedReceipts = [];
  for (const stage of observation.stage_manifests) {
    const job = jobById.get(stage.job_ref);
    const authorized =
      job?.dataset === observation.policy.dataset &&
      job.destination === stage.destination &&
      job.window === Math.floor(stage.event_time / observation.policy.window_size) &&
      job.actor_binding.includes(stage.actor) &&
      job.publisher_bindings.some(
        (binding) =>
          binding.actor === stage.actor && binding.profile_id === stage.publisher_profile_id,
      ) &&
      stage.row_ids.length * stage.columns.length <= job.approved_cell_volume;
    const receipt = receipts.get(stage.stage_ref);
    if (receipt) {
      assert.equal(receipt.status, 'delivered');
      assert.equal(receipt.destination, stage.destination);
      assert.equal(receipt.report_owner, stage.actor);
      assert.equal(receipt.profile_id, stage.publisher_profile_id);
      if (!authorized) {
        exposedReceipts.push(receipt.receipt_id);
      }
    } else if (!authorized) {
      holdStageRefs.push(stage.stage_ref);
    }
  }
  return {
    hold_stage_refs: holdStageRefs.sort(),
    record_receipt_ids: exposedReceipts.sort(),
  };
}
