// Both planners use only the projected SOC view. Swapping the session's
// primary controller plan for its parallel plan lets the existing visible
// authorization interpreter assess each read independently.
import { planReferenceContainment } from '../v20/reference.mjs';

function signature(action) {
  return JSON.stringify(action);
}

function parallelAssessment(visible, session) {
  const alternate = structuredClone(visible);
  const selected = alternate.session_register.find(
    (item) =>
      item.role_arn === session.role_arn && item.role_session_name === session.role_session_name,
  );
  if (!selected?.parallel_plan || !selected.active_plan) {
    throw new Error('parallel read is missing from the visible issued session');
  }
  selected.active_plan = selected.parallel_plan;
  return planReferenceContainment(alternate);
}

function union(left, right) {
  const seen = new Set();
  return [...left, ...right].filter((action) => {
    const key = signature(action);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function planExactSessionResponse(visible) {
  let actions = planReferenceContainment(visible);
  for (const session of visible.session_register.filter((item) => item.parallel_plan)) {
    actions = union(actions, parallelAssessment(visible, session));
  }
  return actions;
}

export function planNarrowResponse(visible) {
  const baseline = planReferenceContainment(visible);
  const actions = [...baseline];
  for (const session of visible.session_register.filter((item) => item.parallel_plan)) {
    const exact = {
      tool: 'deny-role-session',
      args: {
        role_arn: session.role_arn,
        role_session_name: session.role_session_name,
      },
    };
    const deniedForParallel = parallelAssessment(visible, session).some(
      (action) => signature(action) === signature(exact),
    );
    if (deniedForParallel) {
      if (baseline.some((action) => signature(action) === signature(exact))) {
        throw new Error('object A is not a preserved approved read');
      }
      actions.push({
        tool: 'deny-session-resource',
        args: {
          role_arn: session.role_arn,
          role_session_name: session.role_session_name,
          resource: session.parallel_plan.resource,
        },
      });
    }
  }
  return actions;
}
