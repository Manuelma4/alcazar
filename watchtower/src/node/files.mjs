/**
 * File-system access for the CLI (Node.js only; never imported by the
 * browser build). Symbolic links are never followed, files above 2 MB are
 * skipped, and files are opened with O_NOFOLLOW | O_NONBLOCK so a path
 * swapped for a link or a FIFO between the directory walk and the read is
 * refused instead of followed or waited on.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { compileGlob, matchGlob } from './glob.mjs';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_EXCLUDES = Object.freeze(['node_modules', '.git', 'build', 'dist']);
const MAX_DEPTH = 64;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
// O_NONBLOCK: a path swapped for a FIFO must not hang the scan on open().
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const decoder = new TextDecoder('utf-8');

/**
 * @typedef {object} SourceFile
 * @property {string} path  absolute path
 * @property {string} rel   path relative to cwd, forward slashes
 */

/**
 * @typedef {object} Collected
 * @property {SourceFile[]} files
 * @property {string[]} warnings
 * @property {string[]} errors
 */

/**
 * @param {string} cwd
 * @param {string} path
 * @returns {string}
 */
export function relativePath(cwd, path) {
  const rel = relative(cwd, path).split('\\').join('/');
  return rel === '' ? '.' : rel;
}

/**
 * Collect the source files to scan.
 * @param {string[]} inputs
 * @param {{ cwd: string, excludes: string[], extensions: Set<string> }} options
 * @returns {Collected}
 */
export function collectFiles(inputs, { cwd, excludes, extensions }) {
  const globs = [...DEFAULT_EXCLUDES, ...excludes].map(compileGlob);
  /** @type {Collected} */
  const collected = { files: [], warnings: [], errors: [] };
  const seen = new Set();
  for (const input of inputs) {
    const absolute = resolve(cwd, input);
    let stats;
    try {
      stats = lstatSync(absolute);
    } catch (error) {
      collected.errors.push(`cannot read ${input}: ${/** @type {NodeJS.ErrnoException} */ (error).code ?? 'error'}`);
      continue;
    }
    if (stats.isSymbolicLink()) {
      collected.warnings.push(`skipping symbolic link ${relativePath(cwd, absolute)}`);
    } else if (stats.isDirectory()) {
      walk(absolute, absolute, 0, { cwd, globs, extensions, collected, seen });
    } else if (stats.isFile()) {
      addFile(absolute, stats.size, { cwd, collected, seen });
    } else {
      collected.warnings.push(`skipping ${relativePath(cwd, absolute)}: not a regular file`);
    }
  }
  collected.files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return collected;
}

/**
 * @typedef {object} WalkContext
 * @property {string} cwd
 * @property {import('./glob.mjs').Glob[]} globs
 * @property {Set<string>} extensions
 * @property {Collected} collected
 * @property {Set<string>} seen
 */

/**
 * @param {string} root
 * @param {string} dir
 * @param {number} depth
 * @param {WalkContext} ctx
 */
function walk(root, dir, depth, ctx) {
  if (depth > MAX_DEPTH) {
    ctx.collected.warnings.push(`skipping ${relativePath(ctx.cwd, dir)}: directory nesting too deep`);
    return;
  }
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    ctx.collected.errors.push(`cannot read ${relativePath(ctx.cwd, dir)}: ${/** @type {NodeJS.ErrnoException} */ (error).code ?? 'error'}`);
    return;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    const rel = relativePath(ctx.cwd, absolute);
    const fromRoot = relativePath(root, absolute);
    if (ctx.globs.some((glob) => matchGlob(glob, rel) || matchGlob(glob, fromRoot))) continue;
    if (entry.isSymbolicLink()) {
      ctx.collected.warnings.push(`skipping symbolic link ${rel}`);
    } else if (entry.isDirectory()) {
      walk(root, absolute, depth + 1, ctx);
    } else if (entry.isFile() && ctx.extensions.has(extensionOf(entry.name))) {
      let size = 0;
      try {
        size = lstatSync(absolute).size;
      } catch {
        continue;
      }
      addFile(absolute, size, ctx);
    }
  }
}

/**
 * @param {string} name
 * @returns {string}
 */
function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * @param {string} absolute
 * @param {number} size
 * @param {{ cwd: string, collected: Collected, seen: Set<string> }} ctx
 */
function addFile(absolute, size, ctx) {
  const rel = relativePath(ctx.cwd, absolute);
  if (ctx.seen.has(absolute)) return;
  ctx.seen.add(absolute);
  if (size > MAX_FILE_BYTES) {
    ctx.collected.warnings.push(`skipping ${rel}: larger than 2 MB`);
    return;
  }
  ctx.collected.files.push({ path: absolute, rel });
}

/**
 * Read a regular file as UTF-8 without following symbolic links.
 * @param {string} path
 * @returns {string}
 * @throws {Error} when the file is a link, not regular, or too large
 */
export function readSourceFile(path) {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) throw new Error('not a regular file');
    if (stats.size > MAX_FILE_BYTES) throw new Error('larger than 2 MB');
    const buffer = new Uint8Array(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (read === 0) break;
      offset += read;
    }
    return decoder.decode(buffer.subarray(0, offset));
  } finally {
    closeSync(fd);
  }
}

const COPYBOOK_SUFFIXES = ['', '.cpy', '.cob', '.cbl', '.cobol'];

/**
 * Resolve COPY names against the directory of the including file only
 * (case-insensitive, no path separators, no links, size-limited).
 * @param {string} sourcePath
 * @returns {(name: string) => string|null}
 */
export function copybookResolver(sourcePath) {
  const dir = dirname(sourcePath);
  /** @type {Map<string, string>|null} */
  let listing = null;
  return (name) => {
    const clean = name.trim();
    if (clean === '' || clean.includes('/') || clean.includes('\\') || clean.includes('..') || clean.includes('\0')) return null;
    if (!listing) {
      listing = new Map();
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile()) listing.set(entry.name.toLowerCase(), entry.name);
        }
      } catch {
        return null;
      }
    }
    for (const suffix of COPYBOOK_SUFFIXES) {
      const actual = listing.get(`${clean}${suffix}`.toLowerCase());
      if (!actual || actual === basename(sourcePath)) continue;
      try {
        return readSourceFile(join(dir, actual));
      } catch {
        return null;
      }
    }
    return null;
  };
}
