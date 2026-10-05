import fs from 'node:fs';
import path from 'node:path';

function assertRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('Path must be a non-empty relative path');
  }
  if (
    relativePath.includes('\0') ||
    relativePath.includes('\\') ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new Error(`Path must be relative: ${relativePath}`);
  }

  const parts = relativePath.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Path contains traversal or empty components: ${relativePath}`);
  }
  return parts;
}

function assertInside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path resolves outside repository root: ${candidate}`);
  }
}

export function canonicalRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('Repository root is required');
  }
  const canonical = fs.realpathSync(root);
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error(`Repository root is not a directory: ${root}`);
  }
  return canonical;
}

export function resolveInside(root, relativePath, options = {}) {
  const { mustExist = true } = options;
  const canonical = canonicalRoot(root);
  const parts = assertRelativePath(relativePath);
  let current = canonical;
  let missingAncestor = false;

  for (const part of parts) {
    current = path.join(current, part);
    assertInside(canonical, current);
    if (missingAncestor) {
      continue;
    }
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Path traverses a symlink: ${relativePath}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('symlink')) {
        throw error;
      }
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        if (mustExist) {
          throw new Error(`Path does not exist: ${relativePath}`);
        }
        missingAncestor = true;
        continue;
      }
      throw error;
    }
  }

  if (mustExist) {
    const resolved = fs.realpathSync(current);
    assertInside(canonical, resolved);
    return resolved;
  }
  return current;
}

export function readRegularFile(root, relativePath, options = {}) {
  const { maxBytes = Number.POSITIVE_INFINITY } = options;
  const filePath = resolveInside(root, relativePath);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error(`Path is not a regular file: ${relativePath}`);
    }
    if (stat.size > maxBytes) {
      throw new Error(`File exceeds size limit of ${maxBytes} bytes: ${relativePath}`);
    }
    bytes = fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`File is not valid UTF-8: ${relativePath}`);
  }
}

export function makeDirectory(root, relativePath) {
  const canonical = canonicalRoot(root);
  const parts = assertRelativePath(relativePath);
  let current = canonical;

  for (const part of parts) {
    current = path.join(current, part);
    assertInside(canonical, current);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Path traverses a symlink: ${relativePath}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Directory component is not a directory: ${relativePath}`);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        fs.mkdirSync(current);
        continue;
      }
      throw error;
    }
  }
  return current;
}

export function writeNewFile(root, relativePath, content) {
  if (typeof content !== 'string') {
    throw new Error('File content must be a string');
  }
  const parent = path.posix.dirname(relativePath);
  if (parent !== '.') {
    const parentPath = resolveInside(root, parent);
    if (!fs.statSync(parentPath).isDirectory()) {
      throw new Error(`Parent is not a directory: ${parent}`);
    }
  }
  const filePath = resolveInside(root, relativePath, { mustExist: false });
  const descriptor = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, content, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}
