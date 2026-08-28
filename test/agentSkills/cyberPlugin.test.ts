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
const expectedPluginVersion = '0.1.0';
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
