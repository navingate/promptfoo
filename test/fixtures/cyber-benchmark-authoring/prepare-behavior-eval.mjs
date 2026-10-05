#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--help') {
      return { help: true };
    }
    if (!key.startsWith('--') || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${key}`);
    }
    options[key.slice(2).replaceAll('-', '_')] = argv[index + 1];
    index += 1;
  }
  return options;
}

function readCases(repoRoot) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'test/fixtures/cyber-benchmark-authoring/behavior-cases.yml'),
    'utf8',
  );
  const document = yaml.load(source);
  if (!document || !Array.isArray(document.cases)) {
    throw new Error('Behavior case manifest is invalid');
  }
  return document.cases;
}

function provider(label, workingDir, codexHome, model) {
  return {
    id: 'openai:codex-sdk',
    label,
    config: {
      model,
      model_reasoning_effort: 'high',
      working_dir: workingDir,
      skip_git_repo_check: true,
      sandbox_mode: 'read-only',
      enable_streaming: true,
      cli_env: { CODEX_HOME: codexHome },
      output_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['mode', 'references_loaded', 'response', 'criterion_evidence'],
        properties: {
          mode: {
            anyOf: [
              {
                type: 'string',
                enum: [
                  'offense-capability',
                  'defense-detection',
                  'incident-response',
                  'tool-conduct',
                ],
              },
              { type: 'null' },
            ],
          },
          references_loaded: { type: 'array', items: { type: 'string' } },
          response: { type: 'string' },
          criterion_evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'satisfied', 'evidence'],
              properties: {
                id: { type: 'string' },
                satisfied: { type: 'boolean' },
                evidence: { type: 'string' },
              },
            },
          },
        },
      },
    },
  };
}

function assertUncontaminatedAncestors(workspace) {
  let current = path.resolve(workspace);
  while (true) {
    const candidate = path.join(
      current,
      '.agents',
      'skills',
      'cyber-benchmark-authoring',
      'SKILL.md',
    );
    if (fs.existsSync(candidate)) {
      throw new Error(`Baseline ancestor can discover cyber-benchmark-authoring: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return;
    }
    current = parent;
  }
}

export async function prepareBehaviorEval({ outputRoot, repoRoot, model = 'gpt-5.5', authFile }) {
  const requestedOutput = path.resolve(outputRoot);
  fs.mkdirSync(requestedOutput, { recursive: true });
  const absoluteOutput = fs.realpathSync(requestedOutput);
  const absoluteRepo = fs.realpathSync(path.resolve(repoRoot));
  const workspacesRoot = path.join(absoluteOutput, 'workspaces');
  const homesRoot = path.join(absoluteOutput, 'codex-homes');
  const baselineWorkspace = path.join(workspacesRoot, 'baseline');
  const assistedWorkspace = path.join(workspacesRoot, 'assisted');
  const baselineHome = path.join(homesRoot, 'baseline');
  const assistedHome = path.join(homesRoot, 'assisted');
  assertUncontaminatedAncestors(baselineWorkspace);
  for (const directory of [baselineWorkspace, assistedWorkspace, baselineHome, assistedHome]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  if (authFile !== undefined) {
    const sourceAuth = path.resolve(authFile);
    if (!fs.statSync(sourceAuth).isFile()) {
      throw new Error('Auth source must be a regular file');
    }
    for (const home of [baselineHome, assistedHome]) {
      const destination = path.join(home, 'auth.json');
      fs.copyFileSync(sourceAuth, destination, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(destination, 0o600);
    }
  }

  const sourceSkill = path.join(absoluteRepo, '.agents/skills/cyber-benchmark-authoring');
  const assistedSkill = path.join(assistedWorkspace, '.agents/skills/cyber-benchmark-authoring');
  fs.mkdirSync(path.dirname(assistedSkill), { recursive: true });
  fs.cpSync(sourceSkill, assistedSkill, { recursive: true, errorOnExist: true });

  const cases = readCases(absoluteRepo);
  for (const behaviorCase of cases) {
    for (const workspace of [baselineWorkspace, assistedWorkspace]) {
      const inputs = path.join(workspace, 'inputs');
      fs.mkdirSync(inputs, { recursive: true });
      fs.writeFileSync(path.join(inputs, `${behaviorCase.id}.txt`), behaviorCase.request, 'utf8');
    }
  }

  const graderPath = path.join(
    absoluteRepo,
    'test/fixtures/cyber-benchmark-authoring/behavior-grader.mjs',
  );
  const measurerPath = path.join(
    absoluteRepo,
    'test/fixtures/cyber-benchmark-authoring/behavior-measurer.mjs',
  );
  const tests = [];
  for (const behaviorCase of cases) {
    for (const trial of behaviorCase.trials) {
      const positiveAssisted = trial === 'assisted' && behaviorCase.activation_expected;
      const qualityAssertion = {
        type: 'javascript',
        value: `file://${trial === 'baseline' ? measurerPath : graderPath}`,
      };
      if (trial !== 'baseline') {
        qualityAssertion.threshold = 1;
      }
      const assertions = [qualityAssertion];
      if (positiveAssisted) {
        assertions.push({ type: 'skill-used', value: 'cyber-benchmark-authoring' });
      } else {
        assertions.push({ type: 'not-skill-used', value: 'cyber-benchmark-authoring' });
      }
      tests.push({
        description: `${behaviorCase.id} [${trial}]`,
        providers: [`cyber-authoring-${trial}`],
        vars: {
          request: behaviorCase.request,
          caseId: behaviorCase.id,
          activationExpected: behaviorCase.activation_expected,
          expectedMode: behaviorCase.expected_mode ?? 'none',
          expectedReferences: JSON.stringify(behaviorCase.expected_references),
          criteria: JSON.stringify(behaviorCase.criteria),
        },
        options: { disableVarExpansion: true },
        assert: assertions,
      });
    }
  }

  const config = {
    description: 'Isolated cyber benchmark authoring skill comparison',
    prompts: [
      [
        'Handle the following request as a benchmark author or ordinary developer, as appropriate.',
        'Use any applicable project skill you discover. Do not claim to have read a reference you did not read.',
        'Return the required JSON. The response field is the shareable answer.',
        'For each supplied criterion, criterion_evidence must state whether the response satisfies it and copy one exact supporting sentence from the response.',
        '',
        'Request:',
        '{{ request }}',
        '',
        'Criteria:',
        '{{ criteria }}',
      ].join('\n'),
    ],
    providers: [
      provider('cyber-authoring-baseline', baselineWorkspace, baselineHome, model),
      provider('cyber-authoring-assisted', assistedWorkspace, assistedHome, model),
    ],
    tests,
  };
  const configPath = path.join(absoluteOutput, 'promptfooconfig.yaml');
  fs.writeFileSync(
    configPath,
    yaml.dump(config, { noRefs: true, sortKeys: false, lineWidth: 120 }),
    'utf8',
  );
  const metadata = {
    configPath,
    baselineWorkspace,
    assistedWorkspace,
    baselineHome,
    assistedHome,
    model,
    caseCount: cases.length,
    authCopied: authFile !== undefined,
  };
  fs.writeFileSync(
    path.join(absoluteOutput, 'preparation.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  return metadata;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(
        'Usage: prepare-behavior-eval.mjs --output <directory> [--repo-root <path>] [--model <id>] [--auth-file <path>]\n',
      );
    } else {
      if (!args.output) {
        throw new Error('--output is required');
      }
      const defaultRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
      const result = await prepareBehaviorEval({
        outputRoot: args.output,
        repoRoot: args.repo_root ?? defaultRepo,
        model: args.model,
        authFile: args.auth_file,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
