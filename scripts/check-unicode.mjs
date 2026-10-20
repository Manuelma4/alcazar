#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fail when any text file contains bidirectional controls or invisible
// characters (Trojan Source, CVE-2021-42574). The only exempt file is the
// intentional Watchtower sample in examples/vulnerable/.
//
//   node scripts/check-unicode.mjs [root]

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';

const root = process.argv[2] ?? process.cwd();
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'var']);
const TEXT = new Set(['.mjs', '.js', '.json', '.md', '.html', '.css', '.svg', '.yml', '.yaml', '.sh', '.cob', '.cbl',
  '.cpy', '.f90', '.f', '.for', '.h', '.c', '.txt', '.webmanifest', '']);
const EXEMPT = /^examples\/vulnerable\/trojan_source\.[a-z]+$/;
// Code points, not a regex literal: an editor or tool that "helpfully"
// decodes escapes cannot corrupt this list.
const SUSPICIOUS = [
  [0x200b, 0x200d], // zero-width space / non-joiner / joiner
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2060], // word joiner
  [0x2066, 0x2069], // bidi isolates
  [0x180e, 0x180e], // Mongolian vowel separator
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
];
const isSuspicious = (code) => SUSPICIOUS.some(([lo, hi]) => code >= lo && code <= hi);

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* files(path);
    } else if (entry.isFile() && TEXT.has(extname(entry.name).toLowerCase())) {
      yield path;
    }
  }
}

let problems = 0;
for await (const path of files(root)) {
  const name = relative(root, path).split(sep).join('/');
  if (EXEMPT.test(name)) continue;
  const lines = (await readFile(path, 'utf8')).split('\n');
  lines.forEach((line, index) => {
    let column = 0;
    for (const char of line) {
      column += 1;
      const code = char.codePointAt(0);
      if (!isSuspicious(code)) continue;
      problems += 1;
      const hex = code.toString(16).toUpperCase().padStart(4, '0');
      console.error(`${name}:${index + 1}:${column}: U+${hex} (bidirectional or invisible character)`);
    }
  });
}
if (problems > 0) {
  console.error(`check-unicode: ${problems} suspicious character(s) found`);
  process.exit(1);
}
console.log('check-unicode: no bidirectional or invisible characters');
