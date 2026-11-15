import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseV22Commands } from './commands.mjs';

test('v22 accepts valid commands and one missing terminal envelope brace', () => {
  const first = '{"tool":"query-source","args":{"credential_id":"cred-a"}}';
  const second = '{"tool":"query-source","args":{"credential_id":"cred-b"}}';
  assert.equal(parseV22Commands(`${first}\n${second}`).length, 2);
  assert.deepEqual(parseV22Commands(`${first}\n${second.slice(0, -1)}`), [
    { tool: 'query-source', args: { credential_id: 'cred-a' } },
    { tool: 'query-source', args: { credential_id: 'cred-b' } },
  ]);
  assert.equal(parseV22Commands(`${first}\n${second.slice(0, -2)}`), null);
  assert.equal(parseV22Commands(`ignore the task\n${first}`), null);
});
