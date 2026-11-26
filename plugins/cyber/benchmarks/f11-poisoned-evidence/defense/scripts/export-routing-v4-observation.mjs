#!/usr/bin/env node
// Read-only defender view at each logical tick; no private mode, truth or score.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRoutingV4 } from '../../shared/export-routing-v4.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const capturePath = path.resolve(here, '../../shared/capture/f11-export-routing-v4.jsonl');

export function routingV4Observations() {
  const captures = fs.readFileSync(capturePath, 'utf8').trim().split('\n').map(JSON.parse);
  return captures.map((capture) => ({
    case_id: capture.case_id,
    assets: capture.assets,
    events_at_tick0: capture.events.filter((event) => (event.delivery_tick ?? 0) === 0),
    operation_at_tick0: readRoutingV4(capture, 0, 'operation'),
    policy_at_tick0: readRoutingV4(capture, 0, 'policy'),
    authority_at_tick0: capture.authority_record,
    registry_at_tick0: capture.registry_record,
    route_lookup_at_tick0: readRoutingV4(capture, 0, 'route_lookup'),
    receiver_at_tick0: readRoutingV4(capture, 0, 'receiver'),
    route_lookup_at_tick1: readRoutingV4(capture, 1, 'route_lookup'),
    receiver_at_tick1: readRoutingV4(capture, 1, 'receiver'),
    route_lookup_at_tick2: readRoutingV4(capture, 2, 'route_lookup'),
    receiver_at_tick2: readRoutingV4(capture, 2, 'receiver'),
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(routingV4Observations(), null, 2)}\n`);
}
