import { selectorKey } from '../v31/cohorts.mjs';

function currentMembers(group, rows) {
  return group.selectors.map(selectorKey).filter((key) => Object.hasOwn(rows, key));
}

function priorMembership(catalogs, rows, ids) {
  if (new Set(ids).size !== ids.length || Object.keys(rows).length !== 24) {
    return null;
  }
  const occupied = new Set();
  for (const id of ids) {
    const group = catalogs.containment_cohorts.cohorts.find((q) => q.cohort_id === id);
    if (!group) {
      return null;
    }
    const current = currentMembers(group, rows);
    if (current.length !== 6 || current.some((key) => occupied.has(key))) {
      return null;
    }
    for (const key of current) {
      occupied.add(key);
    }
  }
  return occupied;
}

/** Every legal next quarantine under the published prefix rule. */
export function eligibleStagedQuarantines(catalogs, rows, previousIds) {
  const occupied = priorMembership(catalogs, rows, previousIds);
  if (!occupied || previousIds.length > 2) {
    return [];
  }
  const eligible = [];
  for (const group of catalogs.containment_cohorts.cohorts) {
    const current = currentMembers(group, rows);
    if (current.length !== 6 || current.some((key) => occupied.has(key))) {
      continue;
    }
    const unsafe = current.filter((key) => rows[key].status === 'unsafe');
    const approved = current.filter((key) => rows[key].status === 'approved');
    if (previousIds.length === 0 && unsafe.length !== 6) {
      continue;
    }
    if (previousIds.length === 1) {
      if (unsafe.length !== 4 || approved.length !== 2) {
        continue;
      }
      // An E must already be capable of restoring both approved reads without
      // also releasing an unsafe member of either committed quarantine.
      const excluded = [...occupied, ...unsafe];
      if (
        !catalogs.exception_bundles.bundles.some((bundle) => {
          const keys = new Set(currentMembers(bundle, rows));
          return approved.every((key) => keys.has(key)) && excluded.every((key) => !keys.has(key));
        })
      ) {
        continue;
      }
    }
    if (
      previousIds.length === 2 &&
      !(
        unsafe.length === 5 &&
        current.some((key) => key.startsWith('job:') && rows[key].status === 'unresolved')
      )
    ) {
      continue;
    }
    eligible.push({ tool: 'quarantine-cohort', args: { cohort_id: group.cohort_id } });
  }
  return eligible;
}

export function chooseStagedQuarantine(catalogs, rows, previousIds) {
  const choices = eligibleStagedQuarantines(catalogs, rows, previousIds);
  return choices.length === 1 ? choices[0] : null;
}

export function chooseStagedException(catalogs, rows, selectedIds) {
  if (
    selectedIds.length !== 3 ||
    Object.values(rows).some(({ status }) => !['approved', 'unsafe'].includes(status))
  ) {
    return null;
  }
  const occupied = priorMembership(catalogs, rows, selectedIds);
  if (!occupied) {
    return null;
  }
  const choices = catalogs.exception_bundles.bundles.filter((bundle) => {
    const exempt = new Set(currentMembers(bundle, rows));
    return Object.entries(rows).every(
      ([key, { status }]) => (occupied.has(key) && !exempt.has(key)) === (status === 'unsafe'),
    );
  });
  return choices.length === 1
    ? { tool: 'except-cohort', args: { exception_id: choices[0].exception_id } }
    : null;
}
