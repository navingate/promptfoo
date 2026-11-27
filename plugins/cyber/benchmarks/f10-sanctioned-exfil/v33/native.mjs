import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { produceCase as produceV32, verifyNativeProof as verifyV32 } from '../v32/native.mjs';
import { scorePlan as scoreV32 } from '../v32/scorer.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const baseAccounts = ['acct-A', 'acct-B', 'acct-C'];

function accountMaps(seed) {
  const forward = Object.fromEntries(
    baseAccounts.map((account) => [
      account,
      `account-${hash(`f10-v33|${seed}|${account}`).slice(0, 16)}`,
    ]),
  );
  return {
    forward,
    reverse: Object.fromEntries(Object.entries(forward).map(([key, value]) => [value, key])),
  };
}

function replaceAccountStrings(value, replacements) {
  if (typeof value === 'string') {
    return replacements[value] ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceAccountStrings(item, replacements));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceAccountStrings(item, replacements)]),
    );
  }
  return value;
}

export function produceCase(seed, arm) {
  assert.ok(['a', 'b'].includes(arm));
  const base = produceV32(seed, arm);
  const observation = replaceAccountStrings(base.observation, accountMaps(seed).forward);
  observation.case_id = `case-${hash(`f10-v33|${seed}`).slice(0, 18)}`;
  observation.profile_version = 'f10-v33-shared-report-diagnostic-v1';
  observation.account_alias_semantics =
    'opaque account IDs refer to the same authenticated membership and tuple keys throughout this observation';
  return { observation, proof: base.proof };
}

export function scorePlan(seed, arm, plan) {
  const translated = replaceAccountStrings(plan, accountMaps(seed).reverse);
  return scoreV32(seed, arm, translated);
}

export function verifyNativeProof(proof) {
  return verifyV32(proof);
}
