import { spawnSync } from 'node:child_process';

const MAX_READ_LINES = 160;
const MAX_READ_BYTES = 40_000;
const MAX_MATCHES = 60;

function git(sourceRepo, args, { allowNoMatch = false } = {}) {
  const result = spawnSync('git', ['-C', sourceRepo, ...args], {
    encoding: 'utf8',
    maxBuffer: 20_000_000,
  });
  if (result.error || (result.status !== 0 && !(allowNoMatch && result.status === 1))) {
    throw new Error(
      `public source lookup failed: ${result.error?.message ?? result.stderr?.trim()}`,
    );
  }
  return result.stdout ?? '';
}

function safePath(path, { root = false } = {}) {
  if (root && path === '') {
    return '';
  }
  if (
    typeof path !== 'string' ||
    !path ||
    path.length > 500 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')
  ) {
    throw new Error('invalid public source path');
  }
  return path;
}

function parseTreeLine(line) {
  const match = line.match(/^(\d{6}) (blob|tree) ([a-f0-9]{40})\t(.+)$/);
  if (!match) {
    throw new Error('invalid public source tree entry');
  }
  return { mode: match[1], type: match[2], name: match[4] };
}

export function createSourceBrowser({ sourceRepo, revision, overlay = {} }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('source revision must be a full commit hash');
  }
  if (git(sourceRepo, ['rev-parse', 'HEAD']).trim() !== revision) {
    throw new Error('public source checkout is not the pinned revision');
  }
  const source = new Map();
  const edits = new Set();

  function fileMode(path) {
    safePath(path);
    const line = git(sourceRepo, ['ls-tree', revision, '--', path]).trimEnd();
    if (!line) {
      throw new Error('path is not in the pinned public tree');
    }
    const entry = parseTreeLine(line);
    if (
      entry.name !== path ||
      entry.type !== 'blob' ||
      !['100644', '100755'].includes(entry.mode)
    ) {
      throw new Error('path is not a regular public source file');
    }
    return entry.mode;
  }

  function fileText(path) {
    fileMode(path);
    if (source.has(path)) {
      return source.get(path);
    }
    const text = git(sourceRepo, ['show', `${revision}:${path}`]);
    if (text.includes('\0')) {
      throw new Error('binary public source file');
    }
    return text;
  }

  for (const [path, text] of Object.entries(overlay)) {
    fileMode(path);
    if (typeof text !== 'string' || text.includes('\0')) {
      throw new Error('invalid source overlay');
    }
    source.set(path, text);
  }

  return {
    list(path = '') {
      safePath(path, { root: true });
      if (path && git(sourceRepo, ['cat-file', '-t', `${revision}:${path}`]).trim() !== 'tree') {
        throw new Error('path is not a public source directory');
      }
      const object = path ? `${revision}:${path}` : revision;
      const lines = git(sourceRepo, ['ls-tree', object]).trimEnd().split('\n').filter(Boolean);
      return {
        path,
        entries: lines.map((line) => {
          const entry = parseTreeLine(line);
          return { path: path ? `${path}/${entry.name}` : entry.name, type: entry.type };
        }),
      };
    },
    read(path, startLine = 1, maxLines = 120) {
      if (
        !Number.isInteger(startLine) ||
        startLine < 1 ||
        !Number.isInteger(maxLines) ||
        maxLines < 1 ||
        maxLines > MAX_READ_LINES
      ) {
        throw new Error('invalid source line range');
      }
      const lines = fileText(path).split('\n');
      const text = lines.slice(startLine - 1, startLine - 1 + maxLines).join('\n');
      if (Buffer.byteLength(text) > MAX_READ_BYTES) {
        throw new Error('source range too large; request fewer lines');
      }
      return { path, startLine, totalLines: lines.length, text };
    },
    search(query, path = '') {
      safePath(path, { root: true });
      if (
        typeof query !== 'string' ||
        !query.trim() ||
        query.length > 120 ||
        query.includes('\0')
      ) {
        throw new Error('invalid source search query');
      }
      const args = ['grep', '-n', '-i', '-F', '-I', '--', query, revision];
      if (path) {
        args.push('--', path);
      }
      const raw = git(sourceRepo, args, { allowNoMatch: true });
      const matches = [];
      for (const line of raw.split('\n').filter(Boolean)) {
        const match = line.match(/^[^:]+:(.*?):(\d+):(.*)$/);
        if (!match || source.has(match[1])) {
          continue;
        }
        matches.push({ path: match[1], line: Number(match[2]), text: match[3].slice(0, 300) });
      }
      for (const [name, text] of source) {
        if (path && name !== path && !name.startsWith(`${path}/`)) {
          continue;
        }
        text.split('\n').forEach((line, index) => {
          if (line.toLowerCase().includes(query.toLowerCase())) {
            matches.push({ path: name, line: index + 1, text: line.slice(0, 300) });
          }
        });
      }
      matches.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
      return {
        query,
        path,
        matches: matches.slice(0, MAX_MATCHES),
        truncated: matches.length > MAX_MATCHES,
      };
    },
    applyEdit({ path, old, new: replacement }) {
      if (
        typeof old !== 'string' ||
        !old ||
        old.length > 100_000 ||
        typeof replacement !== 'string' ||
        replacement.length > 100_000 ||
        old.includes('\0') ||
        replacement.includes('\0')
      ) {
        throw new Error('invalid exact replacement');
      }
      const current = fileText(path);
      const first = current.indexOf(old);
      if (first < 0 || current.indexOf(old, first + old.length) >= 0) {
        throw new Error('replacement source must occur exactly once');
      }
      if (!edits.has(path) && edits.size >= 8) {
        throw new Error('too many changed source files');
      }
      source.set(
        path,
        `${current.slice(0, first)}${replacement}${current.slice(first + old.length)}`,
      );
      edits.add(path);
      return { path, changed: source.get(path) !== current };
    },
    changedFiles() {
      return [...edits].sort();
    },
    materializedFiles() {
      return Object.fromEntries(source);
    },
  };
}
