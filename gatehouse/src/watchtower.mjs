// SPDX-License-Identifier: Apache-2.0
// Bridge to Watchtower, the COBOL / Fortran static analyzer: scans this
// repository's own legacy code (which must stay clean) and the example
// programs once at start-up, for the dashboard.

import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXTENSIONS = new Set(['.cob', '.cbl', '.cpy', '.cobol', '.f90', '.f95', '.f03', '.f08', '.f18', '.f', '.for', '.ftn', '.f77']);
const GROUPS = [
  { name: 'production', dirs: ['rampart', 'apps'] },
  { name: 'vulnerable', dirs: ['examples/vulnerable'] },
  { name: 'hardened', dirs: ['examples/hardened'] },
];

/**
 * @returns {Promise<{ report: object, examples: object[] } | null>} null when
 *   Watchtower is not installed next to Gatehouse.
 */
export async function buildWatchtowerReport(root) {
  let watchtower;
  try {
    watchtower = await import(pathToFileURL(join(root, 'watchtower', 'src', 'index.mjs')).href);
  } catch {
    return null;
  }
  const groups = [];
  const examples = [];
  for (const group of GROUPS) {
    const results = [];
    for (const dir of group.dirs) {
      for (const path of await sourceFiles(join(root, dir))) {
        const source = await readFile(path, 'utf8');
        const file = relative(root, path).split(sep).join('/');
        results.push({ file, ...watchtower.scan(source, { filename: file }) });
        if (group.name !== 'production') {
          const language = results.at(-1).language;
          examples.push({ name: file.split('/').at(-1), group: group.name, language, path: file, source });
        }
      }
    }
    groups.push({ name: group.name, summary: watchtower.summarize(results), results });
  }
  return {
    report: { generatedAt: new Date().toISOString(), tool: { name: 'Watchtower', version: watchtower.VERSION }, groups },
    examples,
  };
}

async function sourceFiles(dir, depth = 0) {
  if (depth > 6) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(path, depth + 1)));
    else if (entry.isFile() && EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out;
}
