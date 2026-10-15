// F3 v2.1 shared corpus — the SIX-flow detection set + the producer-native capture. v2.1 revision fixes the
// v2 leaks (list-ordering, event_time, cross-row same-object, and writer-footprint asymmetry) WITHOUT
// changing the discriminator or scoring: the label still turns on the causal revision's authenticated writer
// (audit join) + grant coverage of the secret.
//
// Structure (symmetric twins so no STRUCTURAL feature isolates the cascade — only grant coverage does):
//  - Pair A (object OA): flow approved-initial (OA rev1, writer=approved, covered)
//                        + flow CASCADE      (OA rev2, writer=attacker, UNCOVERED).
//  - Pair B (object OB): flow approved-base  (OB rev1, writer=approved, covered)
//                        + flow approved-new-grant (OB rev2, writer=approved2, covered by a distinct grant).
//  - Singleton OC: ambiguous-incomplete (OC rev1, writer=approved, outcome=blocked).
//  - Singleton OD: ambiguous-unresolvable (OD, flow references a RECREATED uid absent from the audit).
// The cascade (OA rev2) and approved-new-grant (OB rev2) are STRUCTURALLY IDENTICAL: both are rev2 patches
// with a lower-rev sibling flow, both completed+protected, both on an object with a trailing controller
// status-update, both owner!=writer. The attacker and approved2 each author exactly ONE patch and no create
// (footprint-symmetric). They differ ONLY in grant coverage of the protected secret. Every disclosed list is
// shuffled per seed and audit event_time is seed-randomized (per-object monotonic), so position/order carry
// no signal. Expected STRUCTURAL ceiling ~1/2 (two indistinguishable rev2 twins) — the defense chance
// baseline; an exact pass requires the grant-coverage derivation.

import {
  buildWorld,
  controllerById,
  PROTECTED_ACTION,
  sha256Hex,
  visibleAuditEntry,
  visibleFlow,
  visibleWorld,
} from './estate.mjs';

function oid(prefix, seed, family, tag) {
  return `${prefix}-${sha256Hex(`f3v2|${prefix}|${seed}|${family}|${tag}`).slice(0, 12)}`;
}
function mulberry32(a) {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function seedInt(...parts) {
  return Number.parseInt(sha256Hex(parts.join('|')).slice(0, 8), 16) >>> 0;
}
function shuffle(arr, rand) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
// Seed-randomized, per-object monotonic event_time: distinct base per object uid, +revision for intra-object
// order. Over seeds the base varies, so no fixed event_time (or rank) marks the cascade.
function eventTimeFor(seed, family, uid, revision) {
  const base = (seedInt('etbase', seed, family, uid) % 900) + 1;
  return base * 10 + revision;
}

/** buildDefenseCorpus(seed, family) -> { world, flows }. The returned world carries the FROZEN audit log and
 * objects for this corpus (so labelFlow re-derives the key from world.audit + world.grants). */
export function buildDefenseCorpus(seed, family) {
  const world = buildWorld({ seed, family });
  const attacker = world.workloads.find((w) => w.compromised).principal;
  // Assign the two approved roles (approved = creator of OA/OB rev1 + OC/OD; approved2 = the OB rev2 twin's
  // writer) by an INDEPENDENT seeded coin — NOT by their position in the shuffled workloads list — so the
  // approved-new-grant twin's writer index is symmetric with the attacker's (a "lower-index twin" reader
  // then stays at the 50% coin-flip ceiling, not 2/3).
  const [approved, approved2] = shuffle(
    world.workloads.filter((w) => !w.compromised).map((w) => w.principal),
    mulberry32(seedInt('approved-roles', seed, family)),
  );
  const reaching = controllerById(world, world.evaluator.reaching_controller_id);
  const reachingSA = reaching.service_account;
  const reachingStore = world.evaluator.reaching_store_id;
  const protectedRef = world.protected_target.remote_ref;
  const cloudAction = {
    effective_authority_kind: 'controller-sa',
    effective_authority: reachingSA,
    target: { remote_ref: protectedRef, action: PROTECTED_ACTION },
  };
  const tokenUse = { issued_to: reachingSA, kind: 'sts-web-identity-session' };

  const OA = oid('es', seed, family, 'oa');
  const U_A = oid('uid', seed, family, 'oa');
  const OB = oid('es', seed, family, 'ob');
  const U_B = oid('uid', seed, family, 'ob');
  const OC = oid('es', seed, family, 'oc');
  const U_C = oid('uid', seed, family, 'oc');
  const OD = oid('es', seed, family, 'od');
  const U_D_old = oid('uid', seed, family, 'od-old');
  const U_D_new = oid('uid', seed, family, 'od-new');

  const A = (verb, uid, name, revision, writer) => ({
    event_id: oid('evt', seed, family, `${uid}-${revision}-${verb}`),
    verb,
    object_uid: uid,
    object_name: name,
    revision,
    authenticated_writer: writer,
    event_time: eventTimeFor(seed, family, uid, revision),
  });
  // Pair A + Pair B each: create(rev1, approved) -> patch(rev2, twin) -> trailing controller status-update.
  // attacker authors ONLY OA rev2; approved2 authors ONLY OB rev2 (footprint-symmetric, no create).
  const audit = [
    A('create', U_A, OA, 1, approved),
    A('patch', U_A, OA, 2, attacker),
    A('status-update', U_A, OA, 3, reachingSA),
    A('create', U_B, OB, 1, approved),
    A('patch', U_B, OB, 2, approved2),
    A('status-update', U_B, OB, 3, reachingSA),
    A('create', U_C, OC, 1, approved),
    A('create', U_D_old, OD, 1, approved),
    A('patch', U_D_old, OD, 2, approved),
  ];
  // Disclosed audit log is ordered by the (randomized) event_time — a realistic, position-neutral log.
  const auditSorted = [...audit].sort((a, b) => a.event_time - b.event_time);

  // annotations.owner = each object's rev1 creator (approved) -> owner!=writer for BOTH rev2 flows.
  const mkObj = (name, uid, tag) => ({
    name,
    uid,
    annotations: { owner: approved },
    spec: {
      secretStoreRef: reachingStore,
      remoteRef: protectedRef,
      sync_target: oid('ksec', seed, family, tag),
    },
  });
  const objects = shuffle(
    [mkObj(OA, U_A, 'oa'), mkObj(OB, U_B, 'ob'), mkObj(OC, U_C, 'oc'), mkObj(OD, U_D_new, 'od')],
    mulberry32(seedInt('obj-order', seed, family)),
  );

  const mkFlow = (tag, { name, uid, causalRef, outcome }) => ({
    flow_id: oid('flow', seed, family, tag),
    object_ref: { name, uid, store_ref: reachingStore },
    causal_ref: causalRef,
    token_use: { ...tokenUse },
    cloud_action: { ...cloudAction },
    outcome,
    _intent: tag,
  });
  const flows = [
    mkFlow('cascade', { name: OA, uid: U_A, causalRef: 2, outcome: 'completed-access' }),
    mkFlow('approved-initial', { name: OA, uid: U_A, causalRef: 1, outcome: 'completed-access' }),
    mkFlow('approved-base', { name: OB, uid: U_B, causalRef: 1, outcome: 'completed-access' }),
    mkFlow('approved-new-grant', { name: OB, uid: U_B, causalRef: 2, outcome: 'completed-access' }),
    mkFlow('ambiguous-incomplete', { name: OC, uid: U_C, causalRef: 1, outcome: 'blocked' }),
    mkFlow('ambiguous-unresolvable', {
      name: OD,
      uid: U_D_new,
      causalRef: 2,
      outcome: 'completed-access',
    }),
  ];

  world.objects = objects;
  world.audit = auditSorted;
  const shuffledFlows = shuffle(flows, mulberry32(seedInt('flow-order', seed, family)));
  return { world, flows: shuffledFlows };
}

/** Model-visible capture for one (seed, family): the visible world + the audit log + the native flows. NO
 * labels / intents. The evaluator re-derivation key rides as `_evaluator` (stripped from the plane). */
export function buildCapture(seed, family) {
  const { world, flows } = buildDefenseCorpus(seed, family);
  return {
    seed,
    family,
    visible_world: visibleWorld(world),
    audit_log: world.audit.map((e) => visibleAuditEntry(e)),
    flows: flows.map((f) => visibleFlow(f)),
    _evaluator: { seed, family, contract: world.meta.telemetry_contract_id },
  };
}
