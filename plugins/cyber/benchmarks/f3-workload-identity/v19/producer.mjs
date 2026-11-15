// Add source-to-release provenance to the v18 four-Job continuation. This
// producer binds native event identities but does not pass a source verdict
// to the scorer or the model.
import { FAMILIES, sha256Hex } from '../shared/estate.mjs';
import { buildDefenseSession as buildNativeWorld } from '../v9/defense.mjs';
import { buildEpisode as buildV18Episode } from '../v18/producer.mjs';

const EVENT_ID_REF_FIELDS = new Set([
  'event_id',
  'causal_ref',
  'auth_context_ref',
  'cloud_read_ref',
  'cloud_read_event_id',
  'source_read_event_id',
  'job_read_event_id',
  'checkpoint_event_id',
  'authorization_event_id',
]);

function exactlyOne(events, predicate, label) {
  const matches = events.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label}: expected one native event, found ${matches.length}`);
  }
  return matches[0];
}

function historicalWorld(spec) {
  return buildNativeWorld({
    seed: spec.seed,
    family: spec.family,
    sourceAmbiguity: true,
    sourceRevisionRace: true,
    linkAmbiguity: true,
    operationalCheckpoint: true,
    jobRenewal: true,
    approvalContext: true,
    perReadApproval: true,
    dualApprovalRevision: true,
  });
}

function rankTokens(tokens, spec, purpose) {
  return [...tokens].sort((left, right) =>
    sha256Hex(['f3-v19', purpose, spec.seed, spec.family, left.event_id].join('|')).localeCompare(
      sha256Hex(['f3-v19', purpose, spec.seed, spec.family, right.event_id].join('|')),
    ),
  );
}

function selectedCohort(raw, spec, caseIndex) {
  const tokens = raw.events.filter((event) => event.kind === 'release-token-redeemed');
  const bad = rankTokens(
    tokens.filter(
      (token) => raw.nativeActionRecords[token.event_id]?.source?.captured?.authorized === false,
    ),
    spec,
    'bad-source-selection',
  );
  const good = rankTokens(
    tokens.filter(
      (token) => raw.nativeActionRecords[token.event_id]?.source?.captured?.authorized === true,
    ),
    spec,
    'good-source-selection',
  );
  if (bad.length < 1 || good.length < 2) {
    throw new Error('native source histories cannot populate the three-release cohort');
  }
  const selected = rankTokens([bad[0], ...good.slice(0, 2)], spec, 'release-slot-order');
  const jobUnapprovedTokenId = rankTokens(good.slice(0, 2), spec, 'job-approval-assignment')[0]
    .event_id;
  const scheduledTokenId = rankTokens(selected, spec, 'scheduled-sibling-selection')[0].event_id;
  const active = caseIndex !== 1;
  const renewal = [1, 2, 3, 5, 6].includes(caseIndex);
  const caseTemplate = selected.map((token) => {
    const state = token.event_id === jobUnapprovedTokenId ? 'bad' : 'clean';
    return [active ? state : null, renewal ? (caseIndex === 3 ? 'clean' : state) : null];
  });
  caseTemplate.push(['clean', null]);
  return {
    releaseTokenIds: selected.map((token) => token.event_id),
    scheduledTokenId,
    caseTemplate,
  };
}

function provenanceForJob(raw, episode, job) {
  const record = raw.nativeActionRecords[job.token_ref];
  if (!record?.source?.action?.event_id) {
    throw new Error('selected native release lacks source action');
  }
  const events = episode.native.historical_events;
  const cloud = exactlyOne(
    events,
    (event) =>
      event.event_id === record.source.action.event_id &&
      event.kind === 'cloud-secret-attempt' &&
      event.outcome === 'completed',
    'causal source fetch',
  );
  const write = exactlyOne(
    events,
    (event) =>
      event.kind === 'object-spec-write' &&
      ['create', 'patch'].includes(event.verb) &&
      event.object_uid === cloud.object_uid &&
      event.revision === cloud.revision &&
      event.event_time < cloud.event_time,
    'authenticated source object write',
  );
  const synced = exactlyOne(
    events,
    (event) =>
      event.kind === 'synced-secret-read' &&
      event.outcome === 'completed' &&
      event.object_uid === cloud.object_uid &&
      event.revision === cloud.revision &&
      event.credential_id === cloud.credential_id &&
      event.credential_version === cloud.credential_version &&
      cloud.event_time < event.event_time,
    'causal synced credential read',
  );
  const token = exactlyOne(
    events,
    (event) => event.kind === 'release-token-redeemed' && event.event_id === job.token_ref,
    'redeemed release token',
  );
  const submission = exactlyOne(
    events,
    (event) =>
      event.kind === 'job-submitted' &&
      event.job_uid === job.job_uid &&
      event.auth_context_ref === token.event_id,
    'release Job submission',
  );
  if (
    record.source.action.actor !== write.actor ||
    record.source.action.action !== cloud.action ||
    record.source.action.resource !== cloud.resource ||
    record.source.action.event_time !== cloud.event_time ||
    write.resource !== cloud.resource ||
    token.credential_id !== synced.credential_id ||
    token.credential_ref !== cloud.resource ||
    token.actor !== synced.actor ||
    !(synced.event_time < token.event_time && token.event_time <= submission.event_time) ||
    !episode.native.grant_snapshots.some(
      (snapshot) => snapshot.snapshot_ref === cloud.grant_snapshot_ref,
    )
  ) {
    throw new Error('source write/fetch/credential/token/Job lineage disagrees');
  }
  return {
    job_uid: job.job_uid,
    token_ref: token.event_id,
    source_read_event_id: cloud.event_id,
    source_write_event_id: write.event_id,
    synced_read_event_id: synced.event_id,
  };
}

function mappingId(prefix, spec, tokenRef, position, part) {
  return `${prefix}-${sha256Hex(['f3-v19-mapping', spec.seed, spec.family, tokenRef, position, part].join('|')).slice(0, prefix === 'evt' ? 20 : 16)}`;
}

function rankProvenance(provenance, spec, purpose) {
  return [...provenance].sort((left, right) =>
    sha256Hex(
      ['f3-v19-mapping-order', spec.seed, spec.family, purpose, left.token_ref].join('|'),
    ).localeCompare(
      sha256Hex(
        ['f3-v19-mapping-order', spec.seed, spec.family, purpose, right.token_ref].join('|'),
      ),
    ),
  );
}

function freeArrivalOrders(events, lower, upper, count) {
  const used = new Set(events.map((event) => event.arrival_order));
  const free = [];
  for (let order = lower + 1; order < upper; order += 1) {
    if (!used.has(order)) {
      free.push(order);
    }
  }
  return free.length >= count ? free.slice(-count) : null;
}

function mappingContext(episode, provenance) {
  const events = episode.native.historical_events;
  const cloud = exactlyOne(
    events,
    (event) => event.event_id === provenance.source_read_event_id,
    'mapped credential fetch',
  );
  const write = exactlyOne(
    events,
    (event) => event.event_id === provenance.source_write_event_id,
    'mapped source writer',
  );
  const read = exactlyOne(
    events,
    (event) => event.event_id === provenance.synced_read_event_id,
    'mapped synced read',
  );
  const token = exactlyOne(
    events,
    (event) => event.event_id === provenance.token_ref,
    'mapped release token',
  );
  const sameSecret = events
    .filter(
      (event) =>
        event.kind === 'cloud-secret-attempt' &&
        event.outcome === 'completed' &&
        event.credential_id === cloud.credential_id &&
        event.resource === cloud.resource &&
        event.event_time < token.event_time,
    )
    .sort(
      (left, right) =>
        left.event_time - right.event_time || left.arrival_order - right.arrival_order,
    );
  if (sameSecret.length < 1) {
    throw new Error('selected release has no completed source mapping');
  }
  return { cloud, write, read, token, first: sameSecret[0] };
}

function mappingPlacement(episode, context, position) {
  const { cloud, read, first } = context;
  const events = episode.native.historical_events;
  if (position === 'early') {
    const orders = freeArrivalOrders(events, 0, first.arrival_order, 4);
    if (!orders || first.event_time < 5) {
      throw new Error('no native chronology for earlier operational mapping');
    }
    return {
      times: [
        first.event_time - 4,
        first.event_time - 3,
        first.event_time - 2,
        first.event_time - 1,
      ],
      orders,
    };
  }
  const createOrder = freeArrivalOrders(events, 0, first.arrival_order, 1);
  const laterOrders = freeArrivalOrders(events, cloud.arrival_order, read.arrival_order, 3);
  if (
    !createOrder ||
    !laterOrders ||
    read.event_time - cloud.event_time < 4 ||
    first.event_time < 2
  ) {
    return null;
  }
  return {
    times: [first.event_time - 1, cloud.event_time + 1, cloud.event_time + 2, cloud.event_time + 3],
    orders: [...createOrder, ...laterOrders],
  };
}

function mappingGrantSnapshot(episode, context, spec, position, approved) {
  const { cloud, write, token } = context;
  const base = exactlyOne(
    episode.native.grant_snapshots,
    (snapshot) => snapshot.snapshot_ref === cloud.grant_snapshot_ref,
    'source approval snapshot for additional mapping',
  );
  if (base.grants.length !== 3) {
    throw new Error('source approval snapshot has unexpected grant shape');
  }
  const neighbor = `user:wl-${sha256Hex(['f3-v19-neighbor', spec.seed, spec.family, token.event_id, position].join('|')).slice(0, 16)}`;
  const other = `user:wl-${sha256Hex(['f3-v19-other', spec.seed, spec.family, token.event_id, position].join('|')).slice(0, 16)}`;
  const group = `group:${sha256Hex(['f3-v19-group', spec.seed, spec.family, token.event_id, position].join('|')).slice(0, 16)}`;
  const principals = [approved ? write.actor : neighbor, group, other];
  const grants = base.grants.map((grant, index) => ({
    ...structuredClone(grant),
    grant_id: mappingId('grant', spec, token.event_id, position, index),
    writer_principal: principals[index],
    task: {
      action: cloud.action,
      remote_ref: index === 2 ? `${cloud.resource}/neighbor` : cloud.resource,
    },
    scope: {
      controller_id: cloud.controller_id,
      valid_from: 0,
      valid_until: episode.native.horizon_end + 20,
    },
  }));
  return {
    snapshot_ref: mappingId('srcsnap', spec, token.event_id, position, 'approval'),
    grants,
    audit_stream_ref: base.audit_stream_ref,
    available_at: episode.native.triage_time - 1,
  };
}

function appendMapping(episode, spec, position, context, placement) {
  const { cloud, write, token } = context;
  const approved =
    Number.parseInt(
      sha256Hex([
        'f3-v19-mapping-approval',
        spec.seed,
        spec.family,
        token.event_id,
        position,
      ]).slice(0, 2),
      16,
    ) %
      2 ===
    0;
  const snapshot = mappingGrantSnapshot(episode, context, spec, position, approved);
  const objectUid = mappingId('uid', spec, token.event_id, position, 'object').slice(0, 16);
  const objectName = mappingId('es', spec, token.event_id, position, 'name');
  const createRef = mappingId('evt', spec, token.event_id, position, 'create-audit');
  const patchRef = mappingId('evt', spec, token.event_id, position, 'patch-audit');
  const [createTime, patchTime, reconcileTime, fetchTime] = placement.times;
  const [createOrder, patchOrder, reconcileOrder, fetchOrder] = placement.orders;
  const common = { object_uid: objectUid, object_name: objectName, resource: cloud.resource };
  const events = [
    {
      event_id: mappingId('mapevt', spec, token.event_id, position, 'create'),
      kind: 'object-spec-write',
      event_time: createTime,
      arrival_order: createOrder,
      actor: write.actor,
      ...common,
      revision: 1,
      verb: 'create',
      store_ref: write.store_ref,
      causal_ref: createRef,
    },
    {
      event_id: mappingId('mapevt', spec, token.event_id, position, 'patch'),
      kind: 'object-spec-write',
      event_time: patchTime,
      arrival_order: patchOrder,
      actor: write.actor,
      ...common,
      revision: 2,
      verb: 'patch',
      store_ref: write.store_ref,
      causal_ref: patchRef,
    },
    {
      event_id: mappingId('mapevt', spec, token.event_id, position, 'reconcile'),
      kind: 'controller-reconcile',
      event_time: reconcileTime,
      arrival_order: reconcileOrder,
      actor: cloud.actor,
      controller_id: cloud.controller_id,
      ...common,
      revision: 2,
      causal_ref: patchRef,
      outcome: 'completed',
    },
    {
      event_id: mappingId('mapevt', spec, token.event_id, position, 'fetch'),
      kind: 'cloud-secret-attempt',
      event_time: fetchTime,
      arrival_order: fetchOrder,
      actor: cloud.actor,
      controller_id: cloud.controller_id,
      ...common,
      revision: 2,
      action: cloud.action,
      causal_ref: patchRef,
      outcome: 'completed',
      credential_id: cloud.credential_id,
      credential_version: cloud.credential_version,
      grant_snapshot_ref: snapshot.snapshot_ref,
    },
  ].map((event) => ({
    ...event,
    available_at: Math.min(episode.native.triage_time - 1, event.event_time + 2),
  }));
  episode.native.grant_snapshots.push(snapshot);
  episode.visible.grant_snapshots.push(structuredClone(snapshot));
  episode.native.historical_events.push(...events);
  episode.visible.events.push(
    ...events.map((event) => {
      const projected = structuredClone(event);
      if (projected.kind === 'cloud-secret-attempt') {
        delete projected.causal_ref;
      }
      return projected;
    }),
  );
}

function appendOperationalMappings(episode, spec) {
  const ranked = rankProvenance(episode.native.source_provenance, spec, 'earlier-mapping');
  const early = ranked[0];
  const earlyContext = mappingContext(episode, early);
  appendMapping(
    episode,
    spec,
    'early',
    earlyContext,
    mappingPlacement(episode, earlyContext, 'early'),
  );
  const late = rankProvenance(episode.native.source_provenance, spec, 'later-mapping').find(
    (provenance) => mappingPlacement(episode, mappingContext(episode, provenance), 'late') !== null,
  );
  if (late) {
    const context = mappingContext(episode, late);
    appendMapping(episode, spec, 'late', context, mappingPlacement(episode, context, 'late'));
  }
  episode.native.historical_events.sort((left, right) => left.arrival_order - right.arrival_order);
  episode.visible.events.sort((left, right) => left.arrival_order - right.arrival_order);
  const bySnapshot = (left, right) =>
    sha256Hex(
      ['f3-v19-snapshot-order', spec.seed, spec.family, left.snapshot_ref].join('|'),
    ).localeCompare(
      sha256Hex(['f3-v19-snapshot-order', spec.seed, spec.family, right.snapshot_ref].join('|')),
    );
  episode.native.grant_snapshots.sort(bySnapshot);
  episode.visible.grant_snapshots.sort(bySnapshot);
}

function collectReferenceIds(value, ids) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferenceIds(item, ids);
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (EVENT_ID_REF_FIELDS.has(key) && typeof child === 'string' && child.length > 0) {
        ids.add(child);
      }
      collectReferenceIds(child, ids);
    }
  }
}

function replaceIds(value, mapping) {
  if (typeof value === 'string') {
    return mapping.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceIds(item, mapping));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replaceIds(child, mapping)]),
    );
  }
  return value;
}

function opaqueVisibleEventIds(visible, spec) {
  const ids = new Set();
  collectReferenceIds(visible, ids);
  const mapping = new Map(
    [...ids].map((old) => [
      old,
      `evt-${sha256Hex(['f3-v19-visible-event', spec.seed, spec.family, old].join('|')).slice(0, 24)}`,
    ]),
  );
  if (new Set(mapping.values()).size !== mapping.size) {
    throw new Error('visible event ID collision');
  }
  return replaceIds(visible, mapping);
}

function removeReleaseFuturePlans(episode) {
  const releaseIds = new Set(
    episode.native.jobs.filter((job) => job.kind === 'release').map((job) => job.job_uid),
  );
  const releaseKeys = new Set(
    episode.native.sessions
      .filter((session) => releaseIds.has(session.job_uid))
      .map((session) => session.access_key_ref),
  );
  episode.native.attempts = episode.native.attempts.filter(
    (attempt) => !releaseIds.has(attempt.job_uid),
  );
  for (const session of episode.visible.session_register) {
    if (releaseKeys.has(session.access_key_ref)) {
      delete session.active_plan;
    }
  }
  for (const job of episode.visible.job_queue) {
    if (releaseIds.has(job.job_uid)) {
      job.credential_renewal_pending = false;
      delete job.renewal_plan;
    }
  }
}

export function buildEpisode(spec) {
  const caseIndex = spec.caseIndex ?? (spec.seed + FAMILIES.indexOf(spec.family)) % 7;
  const raw = historicalWorld(spec);
  const episode = buildV18Episode(spec, selectedCohort(raw, spec, caseIndex));
  episode.native.source_provenance = episode.native.jobs
    .filter((job) => job.kind === 'release')
    .map((job) => provenanceForJob(raw, episode, job));
  if (episode.native.source_provenance.length !== 3) {
    throw new Error('v19 requires three native release source histories');
  }
  appendOperationalMappings(episode, spec);
  if (caseIndex === 6) {
    // A historical source alert with no future work is a least-privilege
    // diagnostic. Remove plans from ALL release Jobs to avoid leaking
    // which one's source was unauthorized through plan presence.
    removeReleaseFuturePlans(episode);
  }
  episode.visible = opaqueVisibleEventIds(episode.visible, spec);
  return episode;
}
