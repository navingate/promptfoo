import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { allowRecursiveOnly, normalizeFinalNewline } from './astra_blind_audit.mjs';
import { addJsonQuoteOnly } from './jsonquote_replay.mjs';

test('Astra diagnostic changes only the recursive CTE prohibition and its preflight case', () => {
  const original = fs.readFileSync(new URL('../../chain-v9/sql_child.py', import.meta.url), 'utf8');
  const quoted = addJsonQuoteOnly(original);
  const patched = allowRecursiveOnly(quoted);
  assert.match(quoted, /recursive SQL denied/u);
  assert.doesNotMatch(patched, /recursive SQL denied/u);
  assert.match(patched, /forbidden SQL preflight failed/u);
  assert.match(patched, /set_authorizer\(authorizer\)/u);
  assert.match(patched, /set_progress_handler\(progress, 100\)/u);
  assert.throws(() => allowRecursiveOnly(patched), /shape mismatch/u);
});

test('Astra first submission permits only transport removal of one final newline', () => {
  const sql = 'SELECT grant_id FROM grants';
  assert.equal(normalizeFinalNewline(sql), sql);
  assert.equal(normalizeFinalNewline(`${sql}\n`), sql);
  assert.equal(normalizeFinalNewline(`${sql}\n\n`), `${sql}\n`);
  assert.throws(() => normalizeFinalNewline(null), /string/u);
});
