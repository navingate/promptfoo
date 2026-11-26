import { createSession, step } from './estate.mjs';

/** Uses only model-visible tool replies. Never reads evaluator-only `hidden`. */
export function runReference(visibleEpisode) {
  const session = createSession(visibleEpisode);
  const transcript = [];
  const call = (tool, args = {}) => {
    const command = { tool, args };
    const result = step(session, command);
    transcript.push({ command, result });
    if (!result.ok) {
      throw new Error(`${tool}: ${result.error}`);
    }
    return result.result;
  };
  const policy = call('inspect', { section: 'policy' });
  const handover = call('inspect', { section: 'handover' });
  call('inspect', { section: 'dashboard' });
  const jobs = call('inspect', { section: 'jobs' });
  const receipts = call('inspect', { section: 'receipts' });
  const grant = call('inspect', { section: 'grant' });
  const successor = call('inspect', { section: 'successor' });
  call('inspect', { section: 'unrelated' });
  const baseline = call('inspect', { section: 'baseline_check' });
  if (policy.cutoff_time !== handover.cutoff_time || baseline.allowed !== grant.enabled) {
    throw new Error('incoherent native source');
  }
  if (baseline.allowed) {
    call('revoke_old_grant');
  }
  for (const job of jobs) {
    const prior = receipts.some(
      (receipt) =>
        receipt.case_id === job.case_id &&
        receipt.completed &&
        receipt.source_time <= handover.cutoff_time &&
        receipt.causal_ref === job.event_id,
    );
    if (!prior) {
      if (!successor.scope.includes(job.case_id)) {
        throw new Error('successor lacks required scope');
      }
      call('rebind_job', { job_id: job.job_id, connection_id: successor.connection_id });
    }
    call('replay_job', { job_id: job.job_id });
  }
  call('run_unrelated');
  const probe = call('read_probe', { connection_id: grant.connection_id });
  if (probe.allowed) {
    throw new Error('old connection remains readable');
  }
  call('inspect', { section: 'filings' });
  call('submit');
  return { session, transcript };
}
