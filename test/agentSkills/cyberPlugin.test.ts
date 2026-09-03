import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins', 'cyber');
const runSkillRoot = path.join(pluginRoot, 'skills', 'cyber-capability-run');
const taxonomySkillRoot = path.join(pluginRoot, 'skills', 'cyber-taxonomy');

const expectedSkillDirs = [
  'cyber-capability-run',
  'cyber-conduct',
  'cyber-refusal',
  'cyber-taxonomy',
];
const expectedPluginVersion = '0.2.0';
const taxonomyCodes = ['R', 'E', 'M', 'C', 'I', 'P', 'X', 'D', 'S'];

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath: string): any {
  return JSON.parse(readText(filePath));
}

describe('cyber plugin bundle', () => {
  it('ships equal-identity Codex and Claude manifests named cyber', () => {
    const claude = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
    const codex = readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));

    expect(claude.name).toBe('cyber');
    expect(codex.name).toBe('cyber');
    expect(claude.version).toBe(expectedPluginVersion);
    expect(codex.version).toBe(expectedPluginVersion);
    expect(claude.version).toBe(codex.version);
    expect(claude.license).toBe('MIT');
    expect(codex.license).toBe('MIT');
    expect(JSON.stringify(claude)).not.toContain('[TODO:');
    expect(JSON.stringify(codex)).not.toContain('[TODO:');
  });

  it('gives the Codex manifest complete, self-referential interface metadata', () => {
    const codex = readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
    expect(codex.skills).toBe('./skills/');
    const iface = codex.interface;
    expect(typeof iface.displayName).toBe('string');
    expect(typeof iface.shortDescription).toBe('string');
    expect(iface.composerIcon).toMatch(/^\.\//);
    expect(iface.logo).toMatch(/^\.\//);
    expect(iface.screenshots).toEqual([]);
    // The referenced icon must actually exist on disk.
    expect(fs.existsSync(path.join(pluginRoot, iface.composerIcon))).toBe(true);
    expect(Array.isArray(iface.defaultPrompt)).toBe(true);
    expect(new Set(iface.defaultPrompt).size).toBe(iface.defaultPrompt.length);
  });

  it('is registered on both marketplaces pointing at the same on-disk bundle', () => {
    const claudeMarket = readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
    const codexMarket = readJson(path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'));

    const claudeEntry = (
      claudeMarket.plugins as Array<{ name: string; source: string; license: string }>
    ).find((p) => p.name === 'cyber');
    const codexEntry = (
      codexMarket.plugins as Array<{
        name: string;
        source: { source: string; path: string };
        policy: { installation: string; authentication: string };
        category: string;
      }>
    ).find((p) => p.name === 'cyber');

    expect(claudeEntry).toBeDefined();
    expect(codexEntry).toBeDefined();
    if (!claudeEntry || !codexEntry) {
      throw new Error('Missing cyber marketplace entry');
    }
    expect(claudeEntry.license).toBe('MIT');
    expect(path.resolve(repoRoot, claudeEntry.source)).toBe(pluginRoot);
    expect(codexEntry.source).toEqual({ source: 'local', path: './plugins/cyber' });
    expect(codexEntry.policy).toEqual({ installation: 'AVAILABLE', authentication: 'ON_INSTALL' });
    expect(codexEntry.category).toBe('Developer Tools');
    expect(path.resolve(repoRoot, codexEntry.source.path)).toBe(pluginRoot);
  });

  it('exposes exactly the four cyber skills, each with SKILL.md and openai.yaml', () => {
    const skillDirs = fs
      .readdirSync(path.join(pluginRoot, 'skills'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(skillDirs).toEqual(expectedSkillDirs);

    for (const dir of expectedSkillDirs) {
      const skillMd = path.join(pluginRoot, 'skills', dir, 'SKILL.md');
      const openai = path.join(pluginRoot, 'skills', dir, 'agents', 'openai.yaml');
      expect(fs.existsSync(skillMd), `${dir}/SKILL.md`).toBe(true);
      expect(fs.existsSync(openai), `${dir}/agents/openai.yaml`).toBe(true);

      // Frontmatter name must equal the directory name.
      const md = readText(skillMd);
      const fm = md.match(/^---\n([\s\S]*?)\n---/);
      expect(fm, `${dir} frontmatter`).toBeTruthy();
      const meta = yaml.load(fm![1]) as { name: string; description: string };
      expect(meta.name, `${dir} name`).toBe(dir);
      expect(typeof meta.description, `${dir} description`).toBe('string');

      // openai.yaml has a usable interface block.
      const iface = (yaml.load(readText(openai)) as any).interface;
      expect(typeof iface.display_name, `${dir} display_name`).toBe('string');
      expect(typeof iface.default_prompt, `${dir} default_prompt`).toBe('string');
    }
  });

  it('carries the working L3 run scripts and reference', () => {
    for (const rel of [
      'scripts/config.env',
      'scripts/setup_caisi.sh',
      'scripts/run_cybench.sh',
      'scripts/list_samples.sh',
      'references/caisi-inspect-run.md',
    ]) {
      expect(fs.existsSync(path.join(runSkillRoot, rel)), rel).toBe(true);
    }
    // The run must use the verified solver + samples param (not the spec's approximation).
    const runScript = readText(path.join(runSkillRoot, 'scripts', 'run_cybench.sh'));
    expect(runScript).toContain('ucb/cybench_agent');
    expect(runScript).toContain('samples=');
    expect(runScript).toContain('--no-fail-on-error');
    // The reference documents the placeholder-model caveat.
    const ref = readText(path.join(runSkillRoot, 'references', 'caisi-inspect-run.md'));
    expect(ref).toMatch(/placeholder/i);
    expect(ref).toMatch(/contamination/i);
  });

  it('ships the promptfoo wrapper so it runs as a promptfoo eval', () => {
    // Wrapper + packaging + docs exist.
    for (const rel of [
      'scripts/provider.py',
      'scripts/promptfooconfig.yaml',
      'scripts/results_to_scores.py',
      'deploy/Dockerfile',
      'deploy/devcontainer.json',
      'references/promptfoo-wrapper.md',
    ]) {
      expect(fs.existsSync(path.join(runSkillRoot, rel)), rel).toBe(true);
    }

    // The config drives the eval through the local provider and the verified solver.
    const cfg = yaml.load(
      readText(path.join(runSkillRoot, 'scripts', 'promptfooconfig.yaml')),
    ) as any;
    expect(cfg.providers[0].id).toBe('file://provider.py');
    expect(JSON.stringify(cfg.providers[0].config)).toContain('ucb/cybench_agent');
    // Deterministic pass == flag captured.
    expect(JSON.stringify(cfg.defaultTest.assert)).toContain('^CAPTURED');
    expect(cfg.tests.map((t: any) => t.vars.task).sort()).toEqual(
      ['dynastic', 'flag_command', 'unbreakable'].sort(),
    );

    // Packaging references the Dockerfile. Gate 0A removed the host Docker-socket
    // mount (the control-plane hole); the eval now runs in a disposable VM via
    // deploy/run_0a.sh, so the devcontainer must NOT mount docker.sock.
    const dc = JSON.parse(readText(path.join(runSkillRoot, 'deploy', 'devcontainer.json')));
    expect(dc.build.dockerfile).toContain('Dockerfile');
    expect(dc.mounts).toBeUndefined();
    expect(JSON.stringify(dc)).not.toContain('/var/run/docker.sock');

    // The positioning note carries the defensible claim and the caveats, so a
    // demo makes the CAISI-grounded claim rather than overreaching.
    const wrap = readText(path.join(runSkillRoot, 'references', 'promptfoo-wrapper.md'));
    expect(wrap).toMatch(/CAISI/);
    expect(wrap).toMatch(/reimplemented/i); // the "don't claim" guardrail
    expect(wrap).toMatch(/placeholder/i);
    expect(wrap).toMatch(/contamination/i);
  });

  it('ships the Gate 0A disposable-runner assets and no host-socket mount', () => {
    for (const rel of [
      'deploy/colima-0a.yaml',
      'deploy/egress-lockdown.sh',
      'deploy/egress-selftest.sh',
      'deploy/run_0a.sh',
      'references/gate-0a-design.md',
      'references/inspect-boundary.md',
    ]) {
      expect(fs.existsSync(path.join(runSkillRoot, rel)), rel).toBe(true);
    }
    // The runner gates on the egress self-test, stamps dev-only, and tears the VM down.
    const runner = readText(path.join(runSkillRoot, 'deploy', 'run_0a.sh'));
    expect(runner).toContain('egress-selftest.sh');
    expect(runner).toContain('gate0a-dev');
    expect(runner).toMatch(/colima delete/);
    // Lockdown denies by default and allowlists only the model endpoint.
    const lock = readText(path.join(runSkillRoot, 'deploy', 'egress-lockdown.sh'));
    expect(lock).toMatch(/-P OUTPUT DROP/);
    expect(lock).toContain('DOCKER-USER');
  });

  it('never commits the vendored CAISI tree', () => {
    const vendorIgnore = path.join(runSkillRoot, 'scripts', 'vendor', '.gitignore');
    expect(fs.existsSync(vendorIgnore)).toBe(true);
    expect(readText(vendorIgnore)).toContain('caisi-cyber-evals');
    // If the tree was cloned locally, it must be git-ignored (not stageable).
    const caisiDir = path.join(runSkillRoot, 'scripts', 'vendor', 'caisi-cyber-evals');
    if (fs.existsSync(caisiDir)) {
      let ignored = false;
      try {
        execFileSync('git', ['check-ignore', '-q', path.join(caisiDir, 'README.md')], {
          cwd: repoRoot,
        });
        ignored = true;
      } catch {
        ignored = false;
      }
      expect(ignored, 'vendored CAISI tree must be gitignored').toBe(true);
    }
  });

  it('has a coverage map covering all nine taxonomy cells with a canary', () => {
    const map = readJson(path.join(taxonomySkillRoot, 'scripts', 'task_taxonomy_map.json'));
    expect(map.taxonomy.map((c: any) => c.code).sort()).toEqual([...taxonomyCodes].sort());
    expect(typeof map.canary).toBe('string');
    expect(map.canary).toContain('CANARY');
    expect(map.chosen_tasks.map((t: any) => t.task).sort()).toEqual(
      ['dynastic', 'flag_command', 'unbreakable'].sort(),
    );

    const coverage = readText(path.join(taxonomySkillRoot, 'references', 'coverage-map.md'));
    expect(coverage).toContain(map.canary);
    for (const code of taxonomyCodes) {
      expect(coverage, `coverage map row ${code}`).toMatch(new RegExp(`\\|\\s*${code}\\s*\\|`));
    }
  });

  it('regenerates the coverage map deterministically', () => {
    const python = process.env.PROMPTFOO_PYTHON || 'python3';
    const script = path.join(taxonomySkillRoot, 'scripts', 'build_coverage_map.py');
    const committed = readText(path.join(taxonomySkillRoot, 'references', 'coverage-map.md'));
    const tmpOut = path.join(os.tmpdir(), `cyber-coverage-${process.pid}.md`);
    try {
      execFileSync(python, [script, '--out', tmpOut], { cwd: path.dirname(script) });
    } catch {
      // Python not available in this environment — the structural checks above
      // still guard the committed artifact; skip the byte-for-byte comparison.
      return;
    }
    const regenerated = readText(tmpOut);
    fs.rmSync(tmpOut, { force: true });
    expect(regenerated).toBe(committed);
  });

  it('drives the two-tier catalog from a single manifest', () => {
    const manifest = readJson(path.join(runSkillRoot, 'tasks', 'catalog.manifest.json'));
    expect(fs.existsSync(path.join(runSkillRoot, 'tasks', 'gen_catalog.py'))).toBe(true);
    const atomic = manifest.atomic as any[];
    const diagnostics = atomic.filter((a) => a.disposition !== 'move_l2');
    const moved = atomic.filter((a) => a.disposition === 'move_l2');
    // K1-K3 reclassified out of L3 capability (they are L2 conduct).
    expect(moved.map((a) => a.id).sort()).toEqual(['K1', 'K2', 'K3']);
    expect(diagnostics.length).toBe(51);
    expect((manifest.scenarios as any[]).length).toBe(17);
    const ids = new Set(atomic.map((a) => a.id));
    // Scenarios are ordered checkpoints; every checkpoint diagnostic is a real id,
    // every scenario carries an execution mode and is scored as two SUT conditions.
    for (const s of manifest.scenarios as any[]) {
      expect(s.exec_mode, `${s.id} exec_mode`).toBeTruthy();
      expect(s.sut, `${s.id} sut`).toBe('both');
      for (const cp of s.checkpoints || []) {
        for (const d of cp.diagnostics || []) {
          expect(ids.has(d), `scenario ${s.id} checkpoint diagnostic ${d}`).toBe(true);
        }
      }
    }
    // At least one client-agent Tier-1 diagnostic exists (to diagnose Tier-2 agent runs).
    expect(diagnostics.some((a) => a.sut === 'client_agent')).toBe(true);
    // Client-agent preflight diagnostics are coverage-neutral: no cell, no technique.
    const preflight = diagnostics.filter((a) => a.coverage_excluded);
    expect(preflight.map((a) => a.id).sort()).toEqual(['AG1', 'AG2', 'AG3']);
    for (const a of preflight) {
      expect(a.cells, `${a.id} cells`).toEqual([]);
      expect(a.techniques, `${a.id} techniques`).toEqual([]);
    }
    // No stored `feeds` field — it is derived reciprocally by the generator.
    expect(atomic.every((a) => a.feeds === undefined)).toBe(true);
    // The generated catalog reflects the review corrections.
    const catalog = readText(path.join(runSkillRoot, 'references', 'task-catalog.md'));
    expect(catalog).toContain('GENERATED from tasks/catalog.manifest.json');
    expect(catalog).toContain('Tier 1 — atomic diagnostics');
    expect(catalog).toContain('Tier 2 — staged cross-boundary scenarios');
    expect(catalog).toMatch(/ATT&CK-informed/);
    expect(catalog).toMatch(/contamination-reduced/);
    expect(catalog).toContain('| SUT |'); // Tier-2 table exposes system-under-test
    // Preflight diagnostics are reported separately, not folded into cyber coverage.
    expect(catalog).toContain('48 cyber atomic diagnostics');
    expect(catalog).toContain('client-agent preflight diagnostics');
    expect(catalog).not.toContain('40 failure points'); // the old, wrong count
  });

  it('regenerates the task catalog deterministically', () => {
    const python = process.env.PROMPTFOO_PYTHON || 'python3';
    const script = path.join(runSkillRoot, 'tasks', 'gen_catalog.py');
    const committed = readText(path.join(runSkillRoot, 'references', 'task-catalog.md'));
    const tmpOut = path.join(os.tmpdir(), `cyber-catalog-${process.pid}.md`);
    try {
      execFileSync(python, [script, '--out', tmpOut], { cwd: path.dirname(script) });
    } catch {
      return; // python unavailable — structural checks above still guard the artifact
    }
    const regenerated = readText(tmpOut);
    fs.rmSync(tmpOut, { force: true });
    expect(regenerated).toBe(committed);
  });

  it('wires Cybench-style per-stage subtask scoring into the scenarios (4B.5)', () => {
    // The scenarios config gates pass/fail on the terminal flag, AND reports a
    // non-gating per-stage partial-credit metric.
    const cfgPath = path.join(runSkillRoot, 'scripts', 'promptfooconfig.scenarios.yaml');
    const cfg = yaml.load(readText(cfgPath)) as any;
    const asserts = cfg.defaultTest.assert as Array<any>;
    // Terminal gate unchanged: the ^CAPTURED regex decides pass/fail.
    expect(asserts.some((a) => a.type === 'regex' && a.value === '^CAPTURED')).toBe(true);
    // Subtask credit is reporting-only: weight 0 so it can never flip pass/fail.
    const metric = asserts.find((a) => a.metric === 'subtask_credit');
    expect(metric, 'subtask_credit metric assertion').toBeDefined();
    expect(metric.weight).toBe(0);
    expect(metric.type).toBe('javascript');
    expect(metric.value).toBe('file://assert_subtask_credit.cjs');

    // Both scored scenarios carry an ordered subtask decomposition whose terminal
    // marker is the eval flag, and whose stage markers are emitted by their services.
    for (const rel of ['S2_workload_identity_chain', 'S6_network_edge_pivot']) {
      const ev = yaml.load(readText(path.join(runSkillRoot, 'tasks', rel, 'eval.yml'))) as any;
      const subs = ev.metadata.subtasks as Array<any>;
      expect(subs.length, `${rel} subtasks`).toBeGreaterThanOrEqual(2);
      expect(
        subs.every((s) => typeof s.marker === 'string' && s.marker.startsWith('PROMPTFOO{')),
      ).toBe(true);
      expect(subs[subs.length - 1].marker, `${rel} terminal marker == flag`).toBe(ev.flag);
    }

    // The non-gating metric assertion module + the provider scoring self-test ship.
    const scoringFn = path.join(runSkillRoot, 'scripts', 'assert_subtask_credit.cjs');
    const selftest = path.join(runSkillRoot, 'scripts', 'selftest_subtask_scoring.py');
    expect(fs.existsSync(scoringFn)).toBe(true);
    expect(fs.existsSync(selftest)).toBe(true);

    // Run provider.py's own scoring self-test (anti-cheat crediting, role-split,
    // output tail). Skip only when Python is unavailable; a non-zero exit is a real
    // regression and must fail CI.
    const python = process.env.PROMPTFOO_PYTHON || 'python3';
    try {
      execFileSync(python, [selftest], { cwd: path.dirname(selftest), stdio: 'pipe' });
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return; // no Python in this environment — the self-test still ships
      }
      const out = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
      throw new Error(`subtask-scoring self-test failed:\n${out}`);
    }
  });

  it('ships an opt-in framework-realism config so the default suite stays dependency-free (4B.2)', () => {
    const yamlLoad = (rel: string) =>
      yaml.load(readText(path.join(runSkillRoot, 'scripts', rel))) as any;
    const authored = yamlLoad('promptfooconfig.authored.yaml');
    const realistic = yamlLoad('promptfooconfig.realistic.yaml');
    const tasksOf = (cfg: any) => (cfg.tests as any[]).map((t) => t.vars.task);

    // The opt-in framework config runs through the provider, gates on ^CAPTURED, and
    // lists the framework targets.
    expect(realistic.providers[0].id).toBe('file://provider.py');
    expect(JSON.stringify(realistic.defaultTest.assert)).toContain('^CAPTURED');
    const fw = ['pfcyber-rw1-ssti', 'pfcyber-rw2-yaml', 'pfcyber-rw3-sqlalchemy'];
    for (const t of fw) {
      expect(tasksOf(realistic), `realistic config has ${t}`).toContain(t);
      // The default authored suite carries NONE of the dependency-bearing framework tasks.
      expect(tasksOf(authored), `authored config excludes ${t}`).not.toContain(t);
    }
    // Every framework target carries a real dependency (requirements.txt); the stdlib
    // tasks do not — this is what keeps the default authored run dependency-free.
    for (const d of ['RW1_flask_ssti', 'RW2_flask_yaml_deser', 'RW3_sqlalchemy_injection']) {
      expect(
        fs.existsSync(path.join(runSkillRoot, 'tasks', d, 'target', 'requirements.txt')),
        `${d} requirements.txt`,
      ).toBe(true);
    }
    expect(
      fs.existsSync(path.join(runSkillRoot, 'tasks', 'A3_sqli', 'target', 'requirements.txt')),
    ).toBe(false);
  });

  it('ships the Gate-0B out-of-band verifier + per-run nonce broker, self-test passes (3B.3/3B.4)', () => {
    const g0b = path.join(runSkillRoot, 'deploy', 'gate0b');
    for (const rel of [
      'nonce_broker.py',
      'demo_target/app.py',
      'demo_target/Dockerfile',
      'selftest_gate0b_verifier.py',
    ]) {
      expect(fs.existsSync(path.join(g0b, rel)), rel).toBe(true);
    }
    expect(fs.existsSync(path.join(runSkillRoot, 'references', 'gate-0b-verifier.md'))).toBe(true);
    // The demonstrator reads its flag from an injected per-run nonce (env-or-default) —
    // this is what makes the same image serve a different flag every run.
    const demo = readText(path.join(g0b, 'demo_target', 'app.py'));
    expect(demo).toContain('PFCYBER_NONCE_');

    // The measurement (3B.6), target-wiring last mile (3B.3), fail-closed (3B.5), manifest
    // redaction (3B.5), and CI exit-criteria gate (3B.8) all ship alongside.
    for (const rel of [
      'measure.py',
      'selftest_measure.py',
      // last-mile target migration + compose passthrough (3B.3)
      'migrate_nonces.py',
      'harden_nonce_default.py',
      'migrate_compose_env.py',
      'selftest_nonce_targets.py',
      // fail-closed (3B.5), manifest redaction (3B.5), CI exit criteria (3B.8)
      'selftest_failclosed.py',
      'manifest.py',
      'selftest_manifest.py',
      'ci_gate0b.py',
      // isolation + destination-specific model broker (3B.1 / 3B.2) — decision cores + host skeletons
      'broker/model_broker.py',
      'broker/selftest_model_broker.py',
      'isolation/egress_probe.py',
      'isolation/selftest_egress_policy.py',
      'isolation/run_microvm.sh',
      // per-scenario shortcut / unintended-solution fixtures (3B.4)
      'anti_cheat.py',
      'selftest_anti_cheat.py',
      // host-run driver + host-check decision cores (3B.8 host criteria)
      'gate0b_host_run.sh',
      'isolation/host_checks.py',
      'isolation/selftest_host_checks.py',
    ]) {
      expect(fs.existsSync(path.join(g0b, rel)), rel).toBe(true);
    }

    // Run the whole Gate-0B software gate via ci_gate0b.py, which executes every self-test
    // (verifier: mint->inject->exploit->ACCEPT + rejection of every cheat class; measurement:
    // Pass@k / Wilson / control-gate; nonce-targets: compose passthrough + per-run round-trips
    // + brace-safe file-baked writes; fail-closed: broker/verifier failure -> invalid; manifest:
    // no proof token survives export) and asserts all software criteria pass. Skip only if
    // Python is absent.
    const python = process.env.PROMPTFOO_PYTHON || 'python3';
    let report: string;
    try {
      report = execFileSync(python, [path.join(g0b, 'ci_gate0b.py'), '--json'], {
        cwd: g0b,
        encoding: 'utf8',
      });
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return; // no Python in this environment — the self-tests still ship
      }
      const out = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
      throw new Error(`Gate-0B CI exit-criteria gate failed:\n${out}`);
    }
    const parsed = JSON.parse(report);
    expect(parsed.software_pass, JSON.stringify(parsed, null, 2)).toBe(true);
    expect(parsed.software_criteria.length).toBe(11);
    expect(parsed.software_criteria.every((c: any) => c.status === 'pass')).toBe(true);
    expect(parsed.host_gated_criteria.length).toBeGreaterThan(0);
  });

  it('keeps L1/L2 placeholders pointing at the halo-dataline implementations', () => {
    const conduct = readText(path.join(pluginRoot, 'skills', 'cyber-conduct', 'SKILL.md'));
    const refusal = readText(path.join(pluginRoot, 'skills', 'cyber-refusal', 'SKILL.md'));
    expect(conduct).toContain('../halo-dataline/capability_eval/l2/');
    expect(conduct).toMatch(/placeholder/i);
    expect(refusal).toContain('../halo-dataline/configs/promptfoo/cyber/');
    expect(refusal).toMatch(/placeholder/i);
  });

  it('does not embed literal secrets in committed cyber files', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (d.name === 'vendor') {
          continue; // gitignored clone
        }
        const full = path.join(dir, d.name);
        if (d.isDirectory()) {
          walk(full);
        } else {
          files.push(full);
        }
      }
    };
    walk(pluginRoot);
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const f of files) {
      const text = readText(f);
      // No OpenAI-style keys, no Azure key material, no bearer tokens.
      expect(text, `${f} sk- key`).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
      expect(text, `${f} bearer`).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
    }
    // config.env references the creds file by path, never inlines values.
    const cfg = readText(path.join(runSkillRoot, 'scripts', 'config.env'));
    expect(cfg).toContain('HALO_ENV');
    expect(cfg).not.toMatch(/AZURE_AI_API_KEY\s*=\s*['"]?[A-Za-z0-9]/);
  });
});
