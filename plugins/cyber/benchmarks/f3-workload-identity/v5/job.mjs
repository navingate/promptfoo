// Read-only production Job estate. Native Job actions and scoring are added in
// the next implementation task; this module currently exposes bounded facts.
import { computeReach, sha256Hex } from '../shared/estate.mjs';

const MAX_READS = 16;
const READ_TOOLS = new Set([
  'list-service-accounts',
  'get-service-account',
  'list-templates',
  'get-template',
  'get-job-policy',
]);

function opaqueId(prefix, seed, family, stream, ordinal) {
  return `${prefix}-${sha256Hex(`f3v5|${stream}|${seed}|${family}|${ordinal}`).slice(0, 16)}`;
}

function shuffle(items, seed, family, stream) {
  return items
    .map((value, index) => ({
      value,
      rank: sha256Hex(`f3v5|shuffle|${stream}|${seed}|${family}|${index}`),
    }))
    .sort((left, right) => left.rank.localeCompare(right.rank))
    .map(({ value }) => value);
}

function rebindSubject(subject, namespace) {
  const name = subject.split(':').at(-1);
  return `system:serviceaccount:${namespace}:${name}`;
}

function projectServiceAccount(controller, namespace, issuer, id) {
  return {
    id,
    name: controller.oidc.sub.split(':').at(-1),
    oidc: {
      issuer,
      sub: rebindSubject(controller.oidc.sub, namespace),
      aud: controller.oidc.aud,
    },
    irsa: {
      base_role_arn: controller.irsa.base_role_arn,
      trust_policy: {
        federated_provider: issuer,
        conditions: controller.irsa.trust_policy.conditions.map((condition) => ({
          ...condition,
          value:
            condition.claim === 'sub' ? rebindSubject(condition.value, namespace) : condition.value,
        })),
      },
    },
    base_role: {
      arn: controller.base_role.arn,
      permissions: controller.base_role.permissions.map((permission) => ({ ...permission })),
      can_assume: [...controller.base_role.can_assume],
    },
    dest_role: {
      arn: controller.dest_role.arn,
      trust: { ...controller.dest_role.trust },
      permissions: controller.dest_role.permissions.map((permission) => ({ ...permission })),
    },
    presented_external_id: controller.presented_external_id,
  };
}

export function jobIdentityCanRead(account, target) {
  if (
    typeof account?.oidc?.issuer !== 'string' ||
    account.oidc.issuer !== account.irsa?.trust_policy?.federated_provider
  ) {
    return false;
  }
  return computeReach(account, target);
}

function createPolicy(releaseWorld) {
  const namespace = releaseWorld.namespace;
  return {
    namespace,
    protected_target: { ...releaseWorld.protected_target },
    admission: {
      image: {
        digest_algorithm: 'sha256',
        signature: {
          issuer: 'release-signing.internal',
          subject: 'tenant-export',
        },
      },
      output: { sink: 'job-artifact', namespace },
      egress: { destination: `artifact-ingest.${namespace}.internal` },
    },
  };
}

function createTemplates(releaseWorld, policy) {
  const { seed, family } = releaseWorld.meta;
  const controls = shuffle(
    [null, 'signature', 'scope', 'output', 'egress'],
    seed,
    family,
    'template-controls',
  );
  const ids = shuffle(
    Array.from({ length: 5 }, (_, index) => opaqueId('tmpl', seed, family, 'template-id', index)),
    seed,
    family,
    'template-id-assignment',
  );
  const templates = controls.map((brokenControl, index) => {
    const digest = `sha256:${sha256Hex(`f3v5|template-image|${seed}|${family}|${ids[index]}`)}`;
    return {
      id: ids[index],
      name: opaqueId('export', seed, family, 'template-name', index),
      image: {
        digest,
        signature: {
          digest,
          issuer:
            brokenControl === 'signature'
              ? 'untrusted-signing.internal'
              : policy.admission.image.signature.issuer,
          subject: policy.admission.image.signature.subject,
        },
      },
      export: {
        action: policy.protected_target.action,
        resource:
          brokenControl === 'scope' ? releaseWorld.other_ref : policy.protected_target.remote_ref,
      },
      output: {
        sink: brokenControl === 'output' ? 'stdout' : policy.admission.output.sink,
        namespace: policy.admission.output.namespace,
      },
      egress: {
        destination:
          brokenControl === 'egress'
            ? `unapproved-ingest.${releaseWorld.namespace}.internal`
            : policy.admission.egress.destination,
      },
    };
  });
  return shuffle(templates, seed, family, 'template-order');
}

export function createJobWorld(releaseWorld, principal) {
  if (!releaseWorld?.meta || typeof principal !== 'string' || !principal) {
    throw new Error('invalid release Job estate inputs');
  }
  const { seed, family } = releaseWorld.meta;
  const admittedControllers = releaseWorld.stores
    .filter(
      (store) => store.namespace_selector.matchLabels.team === releaseWorld.namespace_labels.team,
    )
    .map((store) =>
      releaseWorld.controllers.find((controller) => controller.id === store.controller_id),
    );
  if (admittedControllers.length !== 5 || admittedControllers.some((controller) => !controller)) {
    throw new Error('release Job estate requires five admitted controller identities');
  }
  const issuer = `oidc.eks.ap-south-1.amazonaws.com/id/${sha256Hex(`f3v5|job-issuer|${seed}|${family}`).slice(0, 16)}`;
  const ids = shuffle(
    Array.from({ length: 5 }, (_, index) => opaqueId('sa', seed, family, 'job-sa-id', index)),
    seed,
    family,
    'job-sa-id-assignment',
  );
  const serviceAccounts = shuffle(
    shuffle(admittedControllers, seed, family, 'job-sa-sources').map((controller, index) =>
      projectServiceAccount(controller, releaseWorld.namespace, issuer, ids[index]),
    ),
    seed,
    family,
    'job-sa-order',
  );
  if (
    serviceAccounts.filter((account) => jobIdentityCanRead(account, releaseWorld.protected_target))
      .length !== 1
  ) {
    throw new Error('release Job identity graph must have exactly one capable service account');
  }
  const policy = createPolicy(releaseWorld);
  return {
    releaseWorld,
    principal,
    serviceAccounts,
    templates: createTemplates(releaseWorld, policy),
    policy,
    reads: 0,
    initial: {
      principal,
      namespace: policy.namespace,
      protected_target: { ...policy.protected_target },
      tools: {
        'list-service-accounts': {},
        'get-service-account': { service_account_id: 'id from list-service-accounts' },
        'list-templates': {},
        'get-template': { template_id: 'id from list-templates' },
        'get-job-policy': {},
      },
      rules:
        'Service accounts are selectable in the release namespace. Derive cloud reach from the projected OIDC issuer and claims, role trust, and permissions. An export template must satisfy every image, scope, output, and egress admission condition.',
    },
  };
}

function visibleServiceAccount(account) {
  return {
    id: account.id,
    name: account.name,
    oidc: { ...account.oidc },
    irsa: {
      base_role_arn: account.irsa.base_role_arn,
      trust_policy: {
        federated_provider: account.irsa.trust_policy.federated_provider,
        conditions: account.irsa.trust_policy.conditions.map((condition) => ({ ...condition })),
      },
    },
    base_role: {
      arn: account.base_role.arn,
      permissions: account.base_role.permissions.map((permission) => ({ ...permission })),
      can_assume: [...account.base_role.can_assume],
    },
    dest_role: {
      arn: account.dest_role.arn,
      trust: { ...account.dest_role.trust },
      permissions: account.dest_role.permissions.map((permission) => ({ ...permission })),
    },
    presented_external_id: account.presented_external_id,
  };
}

function visibleTemplate(template) {
  return {
    id: template.id,
    name: template.name,
    image: { digest: template.image.digest, signature: { ...template.image.signature } },
    export: { ...template.export },
    output: { ...template.output },
    egress: { ...template.egress },
  };
}

export function stepJob(world, command) {
  if (
    !command ||
    typeof command !== 'object' ||
    Array.isArray(command) ||
    typeof command.tool !== 'string'
  ) {
    return { ok: false, reason: 'invalid-command' };
  }
  if (!READ_TOOLS.has(command.tool)) {
    return { ok: false, reason: 'unknown-tool' };
  }
  world.reads += 1;
  if (world.reads > MAX_READS) {
    return { ok: false, reason: 'read-budget-exhausted' };
  }
  const args =
    command.args && typeof command.args === 'object' && !Array.isArray(command.args)
      ? command.args
      : {};
  switch (command.tool) {
    case 'list-service-accounts':
      return {
        ok: true,
        value: world.serviceAccounts.map(({ id, name }) => ({ id, name })),
      };
    case 'get-service-account': {
      const account = world.serviceAccounts.find(
        ({ id }) => id === (args.service_account_id ?? args.id),
      );
      return account
        ? { ok: true, value: visibleServiceAccount(account) }
        : { ok: false, reason: 'no-such-service-account' };
    }
    case 'list-templates':
      return { ok: true, value: world.templates.map(({ id, name }) => ({ id, name })) };
    case 'get-template': {
      const template = world.templates.find(({ id }) => id === (args.template_id ?? args.id));
      return template
        ? { ok: true, value: visibleTemplate(template) }
        : { ok: false, reason: 'no-such-template' };
    }
    case 'get-job-policy':
      return { ok: true, value: structuredClone(world.policy) };
  }
}
