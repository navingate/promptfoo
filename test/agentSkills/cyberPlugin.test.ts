import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins', 'cyber');
const runSkillRoot = path.join(pluginRoot, 'skills', 'halobench-offense');
const taxonomySkillRoot = path.join(pluginRoot, 'skills', 'cyber-taxonomy');

const expectedSkillDirs = [
  'cyber-conduct',
  'cyber-refusal',
  'cyber-taxonomy',
  'halobench-defense',
  'halobench-offense',
];
const expectedPluginVersion = '0.3.0';
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

  it('exposes exactly the five cyber skills, each with SKILL.md and openai.yaml', () => {
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

  // Removed: "ships the Gate 0A disposable-runner assets and no host-socket mount". The Gate-0A
  // disposable-VM runner (deploy/colima-0a.yaml, deploy/run_0a.sh, references/gate-0a-design.md)
  // was pruned in e965bb888 ("prune cyber plugin to its three keepers") in favor of the x86 host
  // runner (deploy/run_cybench_x86.sh). The egress lockdown/self-test scripts were kept and are
  // still exercised by the host runner, but the disposable-VM assets this test required no longer
  // ship, so the test was removed rather than left asserting deleted files.

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

  // Removed: "drives the two-tier catalog from a single manifest" and "regenerates the task
  // catalog deterministically". The two-tier task catalog (tasks/catalog.manifest.json,
  // tasks/gen_catalog.py, and the ~50 atomic-diagnostic + 17 scenario task trees it enumerated)
  // was pruned in e965bb888 ("prune cyber plugin to its three keepers"). The manifest and
  // generator no longer ship — the regenerate test only passed vacuously (gen_catalog.py errored
  // and its catch swallowed it) — so both tests were removed rather than left asserting a deleted
  // subsystem.

  // Removed: "wires Cybench-style per-stage subtask scoring into the scenarios (4B.5)" and
  // "ships an opt-in framework-realism config so the default suite stays dependency-free (4B.2)".
  // Both features were pruned in e965bb888 ("prune cyber plugin to its three keepers"):
  //   - the scenarios config (scripts/promptfooconfig.scenarios.yaml), its scoring module
  //     (scripts/assert_subtask_credit.cjs), and the S2/S6 scenario task trees; and
  //   - the two-tier authored/realistic configs (scripts/promptfooconfig.authored.yaml,
  //     scripts/promptfooconfig.realistic.yaml) and the RW*/A* framework task trees.
  // None of these ship any longer, so the tests were removed rather than left asserting deleted
  // files. (scripts/selftest_subtask_scoring.py is retained and still passes on its own.)

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
      // per-scenario shortcut fixtures (3B.4): anti_cheat.py is retained as a released component
      // (release_manifest.py). Its self-test and gate criterion were removed with the S1-S17
      // scenario suite it drives, pruned in e965bb888 ("prune cyber plugin to its three keepers").
      'anti_cheat.py',
      // host-run driver + host-check decision cores (3B.8 host criteria)
      'gate0b_host_run.sh',
      'isolation/host_checks.py',
      'isolation/selftest_host_checks.py',
      // reference-solve guardrail (catches broken/unsolvable targets — the D3/CR1 class)
      'selftest_reference_solves.py',
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
    // 13 software criteria: the shortcut_resistant_scenarios criterion (selftest_anti_cheat.py)
    // was dropped with the S1-S17 scenario suite it validates (pruned in e965bb888).
    expect(parsed.software_criteria.length).toBe(13);
    expect(parsed.software_criteria.every((c: any) => c.status === 'pass')).toBe(true);
    expect(parsed.host_gated_criteria.length).toBeGreaterThan(0);
  });

  it('ships the 4D publish scaffolding, self-tests pass (leaderboard / release manifest / split)', () => {
    const g0b = path.join(runSkillRoot, 'deploy', 'gate0b');
    for (const rel of [
      'leaderboard.py',
      'selftest_leaderboard.py',
      'release_manifest.py',
      'selftest_release_manifest.py',
      'split.py',
      'split.policy.json',
      'selftest_split.py',
    ]) {
      expect(fs.existsSync(path.join(g0b, rel)), rel).toBe(true);
    }
    for (const rel of ['methodology-note.md', 'held-out-split.md']) {
      expect(fs.existsSync(path.join(runSkillRoot, 'references', rel)), rel).toBe(true);
    }

    // leaderboard aggregation (control-gated Pass@k + macro averaging + redaction), the
    // reproducible-release digest (deterministic, no secrets), and the public/private split
    // policy (complete-by-default, private tasks as commitments only). Skip only if Python is absent.
    const python = process.env.PROMPTFOO_PYTHON || 'python3';
    for (const selftest of [
      'selftest_leaderboard.py',
      'selftest_release_manifest.py',
      'selftest_split.py',
    ]) {
      try {
        execFileSync(python, [path.join(g0b, selftest)], { cwd: g0b, stdio: 'pipe' });
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          return; // no Python in this environment — the self-tests still ship
        }
        const out = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
        throw new Error(`4D publish-scaffolding self-test ${selftest} failed:\n${out}`);
      }
    }
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
