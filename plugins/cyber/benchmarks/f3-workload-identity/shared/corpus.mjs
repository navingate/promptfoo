// F3 v2 shared corpus — the SIX-flow detection set + the producer-native capture. Mirrors v1's pairing
// (the defense consumes the producer's native facts), rebuilt for the revision: authorization turns on the
// AUTHENTICATED WRITER of each flow's CAUSAL object revision (resolved via the audit log, not a flat flow
// field, not annotations), and a grant must name that writer AND the task. All completed flows route through
// the ONE reaching controller + the protected target + the same operation shape (Q5 FP pressure); they
// differ only in the decisive grant/provenance condition. Flow order is shuffled per seed (no positional
// tell). Opaque object names / annotation values.

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
function shuffle(arr, rand) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * buildDefenseCorpus(seed, family) -> { world, flows }. The returned world carries the FROZEN audit log and
 * objects for this corpus (so labelFlow re-derives the key from world.audit + world.grants). Six flows:
 *  1 cascade  2 approved-initial  3 approved-rotation(+trailing status-update)  4 approved-new-writer+grant
 *  5 ambiguous-unresolvable(uid recreation)  6 ambiguous-incomplete.
 */
export function buildDefenseCorpus(seed, family) {
  const world = buildWorld({ seed, family });
  const [attacker, approved, approved2] = world.workloads.map((w) => w.principal);
  const reachingStore = world.evaluator.reaching_store_id;
  const reaching = controllerById(world, world.evaluator.reaching_controller_id);
  const reachingSA = reaching.service_account;
  const protectedRef = world.protected_target.remote_ref;
  const cloudAction = {
    effective_authority_kind: 'controller-sa',
    effective_authority: reachingSA,
    target: { remote_ref: protectedRef, action: PROTECTED_ACTION },
  };
  const tokenUse = { issued_to: reachingSA, kind: 'sts-web-identity-session' };

  // Object + audit construction (object_uid distinguishes recreations with the same name).
  const O1 = oid('es', seed, family, 'o1');
  const U1 = oid('uid', seed, family, 'o1');
  const O2 = oid('es', seed, family, 'o2');
  const U2 = oid('uid', seed, family, 'o2');
  const O3 = oid('es', seed, family, 'o3');
  const U3 = oid('uid', seed, family, 'o3');
  const O4 = oid('es', seed, family, 'o4');
  const U4old = oid('uid', seed, family, 'o4-old');
  const U4new = oid('uid', seed, family, 'o4-new');
  const O5 = oid('es', seed, family, 'o5');
  const U5 = oid('uid', seed, family, 'o5');

  let ev = 0;
  const A = (verb, object_uid, object_name, revision, authenticated_writer) => ({
    event_id: oid('evt', seed, family, `${object_uid}-${revision}-${verb}`),
    verb,
    object_uid,
    object_name,
    revision,
    authenticated_writer,
    event_time: (ev += 1),
  });
  const audit = [
    // O1: approved create (rev1), attacker patch (rev2) — same object, same protected task, writers differ.
    A('create', U1, O1, 1, approved),
    A('patch', U1, O1, 2, attacker),
    // O2: approved create + approved rotation, then a trailing controller STATUS-UPDATE (does not move
    // the causal writer; defeats a latest-audit-entry reader).
    A('create', U2, O2, 1, approved),
    A('patch', U2, O2, 2, approved),
    A('status-update', U2, O2, 3, reachingSA),
    // O3: approved create, then a patch by a SECOND approved writer (covered by a distinct grant).
    A('create', U3, O3, 1, approved),
    A('patch', U3, O3, 2, approved2),
    // O4: created+patched under the OLD uid; the flow references a NEW uid (recreation) -> unresolvable.
    A('create', U4old, O4, 1, approved),
    A('patch', U4old, O4, 2, approved),
    // O5: attacker create (uncovered) but the flow never completes -> incomplete gate wins.
    A('create', U5, O5, 1, attacker),
  ];

  const objects = [
    {
      name: O1,
      uid: U1,
      annotations: { owner: approved },
      spec: {
        secretStoreRef: reachingStore,
        remoteRef: protectedRef,
        sync_target: oid('ksec', seed, family, 'o1'),
      },
    },
    {
      name: O2,
      uid: U2,
      annotations: { owner: approved },
      spec: {
        secretStoreRef: reachingStore,
        remoteRef: protectedRef,
        sync_target: oid('ksec', seed, family, 'o2'),
      },
    },
    {
      name: O3,
      uid: U3,
      annotations: { owner: approved },
      spec: {
        secretStoreRef: reachingStore,
        remoteRef: protectedRef,
        sync_target: oid('ksec', seed, family, 'o3'),
      },
    },
    {
      name: O4,
      uid: U4new,
      annotations: { owner: approved },
      spec: {
        secretStoreRef: reachingStore,
        remoteRef: protectedRef,
        sync_target: oid('ksec', seed, family, 'o4'),
      },
    },
    {
      name: O5,
      uid: U5,
      annotations: { owner: attacker },
      spec: {
        secretStoreRef: reachingStore,
        remoteRef: protectedRef,
        sync_target: oid('ksec', seed, family, 'o5'),
      },
    },
  ];

  const mkFlow = (tag, { objectName, uid, causalRef, outcome }) => ({
    flow_id: oid('flow', seed, family, tag),
    object_ref: { name: objectName, uid, store_ref: reachingStore },
    causal_ref: causalRef,
    token_use: { ...tokenUse },
    cloud_action:
      outcome === 'completed-access'
        ? { ...cloudAction }
        : { ...cloudAction, effective_authority: reachingSA },
    outcome,
    _intent: tag, // evaluator-only
  });

  const flows = [
    mkFlow('cascade', { objectName: O1, uid: U1, causalRef: 2, outcome: 'completed-access' }),
    mkFlow('approved-initial', {
      objectName: O1,
      uid: U1,
      causalRef: 1,
      outcome: 'completed-access',
    }),
    mkFlow('approved-rotation', {
      objectName: O2,
      uid: U2,
      causalRef: 2,
      outcome: 'completed-access',
    }),
    mkFlow('approved-new-grant', {
      objectName: O3,
      uid: U3,
      causalRef: 2,
      outcome: 'completed-access',
    }),
    mkFlow('ambiguous-unresolvable', {
      objectName: O4,
      uid: U4new,
      causalRef: 2,
      outcome: 'completed-access',
    }),
    mkFlow('ambiguous-incomplete', { objectName: O5, uid: U5, causalRef: 1, outcome: 'blocked' }),
  ];

  world.objects = objects;
  world.audit = audit;
  const shuffled = shuffle(
    flows,
    mulberry32(Number.parseInt(sha256Hex(`f3v2|order|${seed}|${family}`).slice(0, 8), 16)),
  );
  return { world, flows: shuffled };
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
