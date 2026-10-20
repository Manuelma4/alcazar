// SPDX-License-Identifier: Apache-2.0
// Static files are read once at start-up into an in-memory map keyed by URL
// path. A request is a map lookup — no URL ever becomes a filesystem path,
// so path traversal is not mitigated: it is impossible by construction.

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
});

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 8;

/**
 * @param {string} root
 * @param {{ dir: string, url: string, exclude?: string[] }[]} mounts
 * @returns {Promise<Map<string, { body: Buffer, type: string, etag: string }>>}
 */
export async function loadStaticFiles(root, mounts) {
  const files = new Map();
  for (const mount of mounts) {
    const base = join(root, mount.dir);
    for await (const path of walk(base, new Set(mount.exclude ?? []), 0)) {
      const type = TYPES[extname(path).toLowerCase()];
      if (!type) continue;
      const body = await readFile(path);
      if (body.length > MAX_FILE_BYTES) continue;
      const url = mount.url + relative(base, path).split(sep).join('/');
      const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
      files.set(url, { body, type, etag });
    }
  }
  if (files.has('/index.html')) files.set('/', files.get('/index.html'));
  return files;
}

async function* walk(dir, exclude, depth) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || exclude.has(entry.name)) continue;
    // Symbolic links are never followed out of the tree.
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path, exclude, depth + 1);
    else if (entry.isFile()) yield path;
  }
}
