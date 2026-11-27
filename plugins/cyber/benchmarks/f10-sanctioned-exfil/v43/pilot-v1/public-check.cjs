const { createRequire } = require('node:module');
const path = require('node:path');

function inspectPublicWorkspace(workspace = process.cwd()) {
  const fromRoot = createRequire(path.join(workspace, 'root-entry.cjs'));
  const fromPublisher = createRequire(path.join(workspace, 'worker', 'publisher.cjs'));
  fromPublisher('axios');
  const followEntry = fromPublisher.resolve('follow-redirects');
  const axiosEntry = fromPublisher.resolve('axios');
  return {
    root_follow_version: fromRoot('follow-redirects/package.json').version,
    worker_follow_version: fromPublisher('follow-redirects/package.json').version,
    worker_axios_version: fromPublisher('axios/package.json').version,
    worker_follow_loaded_by_axios: Boolean(require.cache[followEntry]),
    worker_follow_entry: path.relative(workspace, followEntry).replaceAll(path.sep, '/'),
    worker_axios_entry: path.relative(workspace, axiosEntry).replaceAll(path.sep, '/'),
    network_used: false,
  };
}

module.exports = { inspectPublicWorkspace };

if (require.main === module) {
  process.stdout.write(`${JSON.stringify(inspectPublicWorkspace())}\n`);
}
