import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins', 'cyber-defense');
const runSkillRoot = path.join(pluginRoot, 'skills', 'cyber-defense-run');

const expectedPluginVersion = '0.1.0';

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath: string): any {
  return JSON.parse(readText(filePath));
}

describe('cyber-defense plugin bundle', () => {
  it('ships equal-identity Codex and Claude manifests named cyber-defense', () => {
    const claude = readJson(path.join(pluginRoot, '.claude-plugin', 'plugin.json'));
    const codex = readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'));

    expect(claude.name).toBe('cyber-defense');
    expect(codex.name).toBe('cyber-defense');
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
    expect(iface).toBeDefined();
    expect(iface.displayName).toBe('Cyber Defense');
    expect(iface.category).toBe('Developer Tools');
    expect(Array.isArray(iface.defaultPrompt)).toBe(true);
    expect(iface.defaultPrompt.length).toBeGreaterThan(0);
    // Referenced assets must exist on disk (no dangling icon/logo).
    for (const rel of [iface.composerIcon, iface.logo]) {
      expect(typeof rel).toBe('string');
      expect(fs.existsSync(path.join(pluginRoot, rel))).toBe(true);
    }
  });

  it('ships the operator guide and the separate methodology doc', () => {
    expect(fs.existsSync(path.join(pluginRoot, 'DEFENSE.md'))).toBe(true);
    expect(fs.existsSync(path.join(pluginRoot, 'METHODOLOGY.md'))).toBe(true);
    // Methodology must state what v0.1 does NOT measure (no premature capability claim).
    expect(readText(path.join(pluginRoot, 'METHODOLOGY.md'))).toMatch(/does NOT measure/i);
  });

  it('ships the cyber-defense-run skill with valid frontmatter', () => {
    const skill = path.join(runSkillRoot, 'SKILL.md');
    expect(fs.existsSync(skill)).toBe(true);
    const text = readText(skill);
    expect(text.startsWith('---')).toBe(true);
    expect(text).toMatch(/name:\s*cyber-defense-run/);
  });

  it('is registered in both marketplace manifests', () => {
    const claudeMarket = readJson(path.join(repoRoot, '.claude-plugin', 'marketplace.json'));
    const agentsMarket = readJson(path.join(repoRoot, '.agents', 'plugins', 'marketplace.json'));

    const inClaude = claudeMarket.plugins.find((p: any) => p.name === 'cyber-defense');
    expect(inClaude).toBeDefined();
    expect(inClaude.source).toBe('./plugins/cyber-defense');

    const inAgents = agentsMarket.plugins.find((p: any) => p.name === 'cyber-defense');
    expect(inAgents).toBeDefined();
    expect(inAgents.source.path).toBe('./plugins/cyber-defense');
  });
});
