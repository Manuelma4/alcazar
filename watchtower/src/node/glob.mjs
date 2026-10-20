/**
 * Minimal, backtracking-safe glob matching for --exclude: '**' (any number
 * of path segments), '*' (any run within a segment) and '?' (one
 * character). Patterns without '/' match any single path segment (like
 * .gitignore); patterns with '/' match the whole relative path.
 */

/**
 * @typedef {object} Glob
 * @property {string} source
 * @property {string[]} segments
 * @property {boolean} anchored  the pattern contains '/'
 */

/**
 * @param {string} pattern
 * @returns {Glob}
 */
export function compileGlob(pattern) {
  let normalized = pattern.replace(/\\/g, '/');
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  const segments = normalized.split('/').filter((segment) => segment !== '');
  return { source: pattern, segments, anchored: segments.length > 1 };
}

/**
 * Does the relative path (forward slashes) match the glob?
 * @param {Glob} glob
 * @param {string} path
 * @returns {boolean}
 */
export function matchGlob(glob, path) {
  const parts = path.split('/').filter((part) => part !== '' && part !== '.');
  if (glob.segments.length === 0) return false;
  if (!glob.anchored) return parts.some((part) => matchSegment(glob.segments[0], part));
  const width = parts.length + 1;
  const memo = new Int8Array((glob.segments.length + 1) * width);
  return matchFrom(glob.segments, 0, parts, 0, memo, width);
}

/**
 * Segment-level matching with memoisation (polynomial worst case).
 * @param {string[]} pattern
 * @param {number} i
 * @param {string[]} parts
 * @param {number} j
 * @param {Int8Array} memo 0 unknown, 1 true, 2 false
 * @param {number} width
 * @returns {boolean}
 */
function matchFrom(pattern, i, parts, j, memo, width) {
  const key = i * width + j;
  if (memo[key] !== 0) return memo[key] === 1;
  let result;
  if (i === pattern.length) result = j === parts.length;
  else if (pattern[i] === '**') {
    result = matchFrom(pattern, i + 1, parts, j, memo, width)
      || (j < parts.length && matchFrom(pattern, i, parts, j + 1, memo, width));
  } else {
    result = j < parts.length && matchSegment(pattern[i], parts[j]) && matchFrom(pattern, i + 1, parts, j + 1, memo, width);
  }
  memo[key] = result ? 1 : 2;
  return result;
}

/**
 * Wildcard match of one segment ('*' and '?'), iterative two-pointer
 * algorithm: O(pattern * text) worst case, no recursion.
 * @param {string} pattern
 * @param {string} text
 * @returns {boolean}
 */
export function matchSegment(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === '?' || pattern[p] === text[t])) {
      p += 1;
      t += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p;
      mark = t;
      p += 1;
    } else if (star !== -1) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}
