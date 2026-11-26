export const TASK_ID = 'f4-durable-consent-inflight-handover-v20';
export const NATIVE_CONTRACT = 'f4-inflight-handover-native-v1';
export const LIMITS = Object.freeze({ actions: 20, wall_minutes: 8 });
export const TOOL_CONTRACT = Object.freeze({
  inspect: ['section'],
  read_probe: ['connection_id'],
  revoke_old_grant: [],
  rebind_job: ['job_id', 'connection_id'],
  migrate_queued: ['connection_id'],
  replay_job: ['job_id'],
  run_unrelated: [],
  block_tenant: [],
  submit: [],
});
