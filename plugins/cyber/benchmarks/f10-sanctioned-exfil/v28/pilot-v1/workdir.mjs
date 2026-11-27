import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const STAGED = ['eligibility-view.json', 'observation.json', 'view-tool.mjs', 'view.mjs'];

export function createRunDirectories() {
  const modelDirectory = fs.mkdtempSync('/private/tmp/f10-v28-model-');
  const rawDirectory = fs.mkdtempSync('/private/tmp/f10-v28-raw-');
  fs.chmodSync(modelDirectory, 0o700);
  fs.chmodSync(rawDirectory, 0o700);
  assert.notEqual(modelDirectory, rawDirectory);
  return { modelDirectory, rawDirectory };
}

export function permissionConfigArgs(modelDirectory, repositoryRoot) {
  const model = fs.realpathSync(modelDirectory);
  const repository = fs.realpathSync(repositoryRoot);
  assert.ok(model.startsWith('/private/tmp/f10-v28-model-'));
  assert.ok(repository.endsWith('/promptfoo'));
  const filesystem = {
    ':root': 'deny',
    ':minimal': 'read',
    '/System/Library/OpenSSL': 'read',
    '/private/tmp': 'deny',
    '/tmp': 'deny',
    [repository]: 'deny',
    [model]: 'write',
  };
  const toml = `{${Object.entries(filesystem)
    .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`)
    .join(',')}}`;
  return [
    '-c',
    'default_permissions="f10pilot"',
    '-c',
    `permissions.f10pilot.filesystem=${toml}`,
    '-c',
    'permissions.f10pilot.network.enabled=false',
  ];
}

export function stageModelDirectory(modelDirectory, item, sourceDirectory) {
  assert.deepEqual(fs.readdirSync(modelDirectory), [], 'model-directory-not-empty');
  fs.writeFileSync(
    path.join(modelDirectory, 'observation.json'),
    `${JSON.stringify(item.observation, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(modelDirectory, 'eligibility-view.json'),
    `${JSON.stringify(item.deployed_view, null, 2)}\n`,
  );
  for (const name of ['view-tool.mjs', 'view.mjs']) {
    fs.copyFileSync(path.join(sourceDirectory, name), path.join(modelDirectory, name));
  }
  return snapshotModelDirectory(modelDirectory);
}

export function snapshotModelDirectory(modelDirectory) {
  assert.deepEqual(fs.readdirSync(modelDirectory).sort(), STAGED, 'unexpected-model-files');
  return Object.fromEntries(
    STAGED.map((name) => {
      const file = path.join(modelDirectory, name);
      assert.equal(fs.lstatSync(file).isFile(), true, 'staged-file-must-be-regular');
      return [name, sha256(fs.readFileSync(file))];
    }),
  );
}

export function inspectModelDirectory(modelDirectory, staged) {
  let after;
  try {
    after = snapshotModelDirectory(modelDirectory);
  } catch {
    return { sound: false, reason: 'unexpected-or-nonregular-model-files' };
  }
  for (const name of STAGED.filter((file) => file !== 'eligibility-view.json')) {
    if (after[name] !== staged[name]) {
      return { sound: false, reason: `noneditable-file-changed:${name}` };
    }
  }
  let definition;
  try {
    definition = JSON.parse(
      fs.readFileSync(path.join(modelDirectory, 'eligibility-view.json'), 'utf8'),
    );
  } catch {
    return { sound: true, reason: 'malformed-edited-view', definition: null, hashes: after };
  }
  return { sound: true, reason: null, definition, hashes: after };
}
