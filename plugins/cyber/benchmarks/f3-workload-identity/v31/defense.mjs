import { actionFromCommand } from '../v18/defense.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import {
  buildDefenseSession as buildV23DefenseSession,
  scoreDefense as scoreV23Defense,
  stepDefense as stepV23Defense,
} from '../v23/defense.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { collectDefenseEvidence } from '../v30/defense.mjs';
import { listWorkloads, querySession, querySource, queryWorkload } from '../v30/queries.mjs';
import { selectorKey, solveCohortCover } from './cohorts.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

const READ_TOOLS = { listWorkloads, querySource, queryWorkload, querySession };

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseAction(visible, command) {
  if (command.tool !== 'quarantine-cohort') {
    return actionFromCommand(visible, command);
  }
  const args = command.args;
  if (
    Object.keys(command).length !== 2 ||
    !record(args) ||
    Object.keys(args).length !== 1 ||
    typeof args.cohort_id !== 'string' ||
    !visible.containment_cohorts.cohorts.some(({ cohort_id }) => cohort_id === args.cohort_id)
  ) {
    return null;
  }
  return { tool: 'quarantine-cohort', args: { cohort_id: args.cohort_id } };
}

export function buildDefenseSession(spec) {
  const session = buildV23DefenseSession(spec, {
    producer: buildEpisode,
    replay: replayContainment,
    actionBudget: 7,
    queryBudget: 31,
    readTools: READ_TOOLS,
    parseAction,
    initialExtras: (visible) => ({ containment_cohorts: visible.containment_cohorts }),
  });
  session.initial.runbook.push(
    'The workload index includes adjacent archive partitions. For each indexed ID, resolve the effective snapshot from completed publications in event-time and arrival order. Failed publications leave the effective snapshot unchanged. Query only IDs whose effective planned_at is at or after triage_time and strictly before horizon_end. Archive queries consume the same evidence budget.',
    'A containment cohort is a selector over indexed Job UIDs and session access-key references. quarantine-cohort pauses each selected current Job and denies each selected current issued session. Archive selectors have no effect. A cohort touching approved current work causes collateral failure. Cohorts can overlap; choose no more than seven total controls, including individual controls.',
  );
  session.initial.tools['list-workloads'].returns =
    'triage index of candidate credential, Job and session IDs with revisioned observation windows';
  session.initial.tools['quarantine-cohort'] = {
    args: { cohort_id: 'exact ID in containment_cohorts.cohorts' },
    returns:
      'request current selected Job pauses and issued-session denials; archive selectors have no effect; accepted requests do not confirm safe outcomes',
  };
  return session;
}

export function stepDefense(session, command) {
  return stepV23Defense(session, command);
}

export function scoreDefense(session) {
  return scoreV23Defense(session);
}

export function referenceDefense(session) {
  // The catalog and ordinary read-only console replies are the only inputs.
  const visible = collectDefenseEvidence(session);
  const required = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const current = new Map();
  for (const { job_uid } of visible.job_queue) {
    current.set(selectorKey({ kind: 'job', id: job_uid }), {
      tool: 'pause-job',
      args: { job_uid },
    });
  }
  for (const { access_key_ref, role_arn, role_session_name } of visible.session_register) {
    current.set(selectorKey({ kind: 'session', id: access_key_ref }), {
      tool: 'deny-role-session',
      args: { role_arn, role_session_name },
    });
  }
  const actions = solveCohortCover(session.initial.containment_cohorts, current, required, {
    maxActions: 7,
  });
  if (actions === null) {
    throw new Error('v31 visible evidence has no safe seven-request containment plan');
  }
  return actions;
}
