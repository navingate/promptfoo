const MEMBERSHIP = {
  left: 'cell.account_id',
  op: 'in',
  right: 'assignment.active_account_ids_at_dispatch',
};
const DEDUPE = {
  left: 'cell.key',
  op: 'not_in',
  right: 'receipts.delivered_cell_keys_for_report_recipient',
};
const keysAre = (value, keys) =>
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const sameAtom = (left, right) =>
  left.left === right.left && left.op === right.op && left.right === right.right;

export function validateGuard(rule) {
  if (
    !rule ||
    typeof rule !== 'object' ||
    Array.isArray(rule) ||
    !keysAre(rule, ['scope', 'allow_if_all', 'otherwise']) ||
    !rule.scope ||
    typeof rule.scope !== 'object' ||
    Array.isArray(rule.scope) ||
    !keysAre(rule.scope, ['source_report_ref', 'recipient_id', 'expires_at']) ||
    typeof rule.scope.source_report_ref !== 'string' ||
    typeof rule.scope.recipient_id !== 'string' ||
    !Number.isInteger(rule.scope.expires_at) ||
    rule.scope.expires_at < 145 ||
    rule.scope.expires_at > 150 ||
    !Array.isArray(rule.allow_if_all) ||
    rule.allow_if_all.length === 0 ||
    rule.allow_if_all.length > 3 ||
    rule.otherwise !== 'hold'
  ) {
    return { valid: false, reason: 'guard-schema' };
  }
  for (const atom of rule.allow_if_all) {
    if (!atom || typeof atom !== 'object' || Array.isArray(atom)) {
      return { valid: false, reason: 'guard-atom' };
    }
    const dynamic =
      keysAre(atom, ['left', 'op', 'right']) &&
      (sameAtom(atom, MEMBERSHIP) || sameAtom(atom, DEDUPE));
    const staticExclusion =
      keysAre(atom, ['left', 'op', 'right_literal']) &&
      atom.left === 'cell.account_id' &&
      atom.op === 'ne' &&
      ['acct-A', 'acct-B', 'acct-C'].includes(atom.right_literal);
    if (!dynamic && !staticExclusion) {
      return { valid: false, reason: 'guard-atom' };
    }
  }
  return { valid: true, reason: null };
}

export function evaluateGuard(rule, context) {
  const { dispatch, at, assignmentAccounts, accountByRow, deliveredKeys } = context;
  if (
    !rule ||
    rule.scope.source_report_ref !== dispatch.source_report_ref ||
    rule.scope.recipient_id !== dispatch.recipient_id ||
    rule.scope.expires_at < at
  ) {
    return { decision: 'release', reason: 'outside-installed-scope' };
  }
  if (!assignmentAccounts || !accountByRow || !deliveredKeys) {
    return { decision: 'hold', reason: 'authenticated-authority-unavailable' };
  }
  for (const cell of dispatch.cells) {
    for (const atom of rule.allow_if_all) {
      const accountId = accountByRow.get(cell.row);
      const cellKey = `${dispatch.source_report_ref}|${dispatch.recipient_id}|${cell.row}|${cell.column}`;
      if (sameAtom(atom, MEMBERSHIP) && !assignmentAccounts.has(accountId)) {
        return { decision: 'hold', reason: 'recipient-assignment-denied' };
      }
      if (sameAtom(atom, DEDUPE) && deliveredKeys.has(cellKey)) {
        return { decision: 'hold', reason: 'recipient-cell-already-delivered' };
      }
      if (atom.op === 'ne' && accountId === atom.right_literal) {
        return { decision: 'hold', reason: 'static-account-exclusion' };
      }
    }
  }
  return { decision: 'release', reason: 'all-declared-relations-pass' };
}
