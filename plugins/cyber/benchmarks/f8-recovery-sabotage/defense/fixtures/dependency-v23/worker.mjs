import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import * as tar from 'tar';

const selectedMembers = ['orders.json', 'customer-profile.json'];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const root = process.cwd();
  const approval = JSON.parse(await readFile(join(root, 'approval.json'), 'utf8'));
  if (approval.destination !== 'recovered') {
    throw new Error('unapproved recovery destination');
  }
  const destination = join(root, approval.destination);
  await mkdir(destination, { recursive: true });

  // This async member-selection path is the one named in the upstream advisory.
  await tar.x({ file: join(root, 'bundle.tar'), cwd: destination }, selectedMembers);

  for (const member of selectedMembers) {
    const restored = await readFile(join(destination, member));
    if (sha256(restored) !== approval.expected_sha256[member]) {
      throw new Error(`restored digest mismatch: ${member}`);
    }
  }

  const orders = JSON.parse(await readFile(join(destination, 'orders.json'), 'utf8'));
  const profile = JSON.parse(await readFile(join(destination, 'customer-profile.json'), 'utf8'));
  const next = approval.approved_new_order;
  if (!Array.isArray(orders.orders) || typeof next?.id !== 'string') {
    throw new Error('invalid recovery order data');
  }
  if (next.customer !== profile.customer) {
    throw new Error('new order does not belong to recovered customer');
  }
  if (!orders.orders.some((order) => order.id === next.id)) {
    orders.orders.push(next);
  }
  await writeFile(join(destination, 'served-orders.json'), `${JSON.stringify(orders, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ restored: selectedMembers, served_order: next.id })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
