// SPDX-License-Identifier: Apache-2.0
// Operator authentication: the token (generated, from a file or from the
// environment), Lookout's session cookie, and the refusals around them.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Sessions, readCookie } from '../src/auth.mjs';
import { ROOT, loadConfig } from '../src/config.mjs';
import { SKIP_REASON, VALID, postJson, startGatehouse } from './helpers.mjs';

const TOKEN = 'operator-token-for-the-auth-tests-0123456789';

describe('Defaults', () => {
  it('want the operator token and keep demo mode off', () => {
    const config = loadConfig({});
    assert.equal(config.auth, 'token');
    assert.equal(config.demo, false);
    assert.throws(() => loadConfig({ ALCAZAR_AUTH: 'off' }), /ALCAZAR_AUTH must be one of: token, none/);
  });
});

describe('Sessions', () => {
  it('expire, can be revoked, and are bounded', () => {
    let now = 1_000;
    const sessions = new Sessions({ ttlMs: 100, max: 2, now: () => now });
    const a = sessions.create();
    assert.equal(sessions.valid(a.id), true);
    assert.equal(sessions.valid(`${a.id.slice(0, -1)}x`), false);
    assert.equal(sessions.valid('not a session id'), false);
    now += 100;
    assert.equal(sessions.valid(a.id), false, 'expired');
    const b = sessions.create();
    const c = sessions.create();
    const d = sessions.create();
    assert.equal(sessions.valid(b.id), false, 'the oldest goes first');
    assert.equal(sessions.valid(c.id) && sessions.valid(d.id), true);
    sessions.revoke(c.id);
    assert.equal(sessions.valid(c.id), false);
  });

  it('read only the named cookie', () => {
    assert.equal(readCookie('a=1; alz_session=xyz; b=2', 'alz_session'), 'xyz');
    assert.equal(readCookie('xalz_session=1', 'alz_session'), null);
    assert.equal(readCookie(undefined, 'alz_session'), null);
  });
});

describe('Operator authentication', { skip: SKIP_REASON }, () => {
  let gh;
  before(async () => {
    gh = await startGatehouse({ ALCAZAR_AUTH: 'token' });
  });
  after(() => gh.stop());

  const get = (path, headers = {}) => fetch(gh.base + path, { headers });
  const signIn = async (token) => {
    const res = await postJson(gh.base, '/api/session', { token });
    const cookie = res.headers.get('set-cookie');
    return { res, cookie, pair: cookie?.split(';')[0] ?? null };
  };

  it('generates a token for this run when none is configured', () => {
    assert.match(gh.app.signIn, /^[A-Za-z0-9_-]{32}$/);
  });

  it('leaves the page and /api/health public, and nothing else', async () => {
    assert.equal((await get('/')).status, 200);
    const health = await (await get('/api/health')).json();
    assert.equal(health.auth, 'token');
    for (const path of ['/api/sample', '/api/posture', '/api/session', '/api/watchtower/report', '/api/jobs/j-0123456789abcdef01234567']) {
      const res = await get(path);
      assert.equal(res.status, 401, path);
      assert.equal(res.headers.get('www-authenticate'), 'Bearer realm="Gatehouse"');
      assert.equal((await res.json()).error.code, 'P-AUTH');
    }
    assert.equal((await postJson(gh.base, '/api/batch', { transactions: [VALID] })).status, 401);
  });

  it('trades the token for an HttpOnly, SameSite=Strict session cookie', async () => {
    const { res, cookie, pair } = await signIn(gh.app.signIn);
    assert.equal(res.status, 200);
    assert.match(cookie, /^alz_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/);
    assert.deepEqual(await (await get('/api/session', { cookie: pair })).json(), { auth: 'token', via: 'session' });
    const batch = await postJson(gh.base, '/api/batch', { transactions: [VALID] }, { cookie: pair });
    assert.equal(batch.status, 200);
    const job = await batch.json();
    assert.equal((await get(`/api/jobs/${job.job}`, { cookie: pair })).status, 200);
  });

  it('signs out: the cookie is cleared and the session is dead', async () => {
    const { pair } = await signIn(gh.app.signIn);
    const out = await fetch(`${gh.base}/api/session`, { method: 'DELETE', headers: { cookie: pair } });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /^alz_session=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/);
    assert.equal((await get('/api/session', { cookie: pair })).status, 401);
  });

  it('refuses a wrong token, a forged cookie, a cross-site sign-in and a malformed body', async () => {
    assert.equal((await signIn(`${gh.app.signIn}x`)).res.status, 401);
    assert.equal((await signIn('')).res.status, 401);
    assert.equal((await get('/api/session', { cookie: `alz_session=${'A'.repeat(43)}` })).status, 401);
    const crossSite = await postJson(gh.base, '/api/session', { token: gh.app.signIn }, { origin: 'http://evil.example' });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.headers.get('set-cookie'), null);
    assert.equal((await postJson(gh.base, '/api/session', { token: gh.app.signIn, admin: true })).status, 400);
    assert.equal((await postJson(gh.base, '/api/session', 'token')).status, 400);
  });

  it('takes the token as a bearer token, for scripts', async () => {
    assert.deepEqual(await (await get('/api/session', { authorization: `Bearer ${gh.app.signIn}` })).json(), { auth: 'token', via: 'bearer' });
    // A wrong bearer token is refused, whatever cookie comes with it.
    const { pair } = await signIn(gh.app.signIn);
    assert.equal((await get('/api/sample', { authorization: 'Bearer wrong', cookie: pair })).status, 401);
  });
});

describe('Operator token configuration', { skip: SKIP_REASON }, () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'alcazar-auth-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));
  const work = () => join(dir, `work-${Math.random().toString(36).slice(2)}`);

  it('refuses no authentication off loopback, and contradictory or weak settings', async () => {
    await assert.rejects(startGatehouse({ ALCAZAR_AUTH: 'none', ALCAZAR_HOST: '0.0.0.0' }, { workDir: work() }), /refused on 0\.0\.0\.0/);
    await assert.rejects(startGatehouse({ ALCAZAR_AUTH: 'none', ALCAZAR_API_TOKEN: TOKEN }, { workDir: work() }), /cannot be combined/);
    await assert.rejects(startGatehouse({ ALCAZAR_API_TOKEN: 'short' }, { workDir: work() }), /32 to 512 printable ASCII/);
    await assert.rejects(startGatehouse({ ALCAZAR_API_TOKEN: `${TOKEN} with spaces` }, { workDir: work() }), /32 to 512 printable ASCII/);
  });

  it('reads the token from a 0600 file, never from one others can read', async () => {
    const file = join(dir, 'operator.token');
    await writeFile(file, `${TOKEN}\n`, { mode: 0o600 });
    const gh = await startGatehouse({ ALCAZAR_API_TOKEN_FILE: file }, { workDir: work() });
    try {
      assert.equal(gh.app.signIn, null, 'a configured token is never printed');
      assert.equal((await fetch(`${gh.base}/api/session`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 200);
    } finally {
      await gh.stop();
    }
    await chmod(file, 0o644);
    await assert.rejects(startGatehouse({ ALCAZAR_API_TOKEN_FILE: file }, { workDir: work() }), /chmod 600/);
    await writeFile(file, 'too-short\n', { mode: 0o600 });
    await chmod(file, 0o600);
    await assert.rejects(startGatehouse({ ALCAZAR_API_TOKEN_FILE: file }, { workDir: work() }), /must hold the operator token/);
  });

  it('pins the cookie to the host and to TLS when served over HTTPS', async () => {
    const gh = await startGatehouse({ ALCAZAR_API_TOKEN: TOKEN, ALCAZAR_HSTS: '1' }, { workDir: work() });
    try {
      const res = await postJson(gh.base, '/api/session', { token: TOKEN });
      assert.match(res.headers.get('set-cookie'), /^__Host-alz_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
    } finally {
      await gh.stop();
    }
  });

  it('prints a sign-in link once, and the hardened launcher reads a token file from a secret mount', async () => {
    const secrets = join(dir, 'secrets');
    await mkdir(secrets, { mode: 0o700 });
    await writeFile(join(secrets, 'operator.token'), TOKEN, { mode: 0o600 });
    for (const [env, check] of [
      [{}, async (lines, base) => {
        const link = lines.find((l) => l.signIn)?.signIn;
        assert.match(link, /^http:\/\/localhost:\d+\/#signin=[A-Za-z0-9_-]{32}$/);
        const token = link.split('#signin=')[1];
        assert.equal((await fetch(`${base}api/session`, { headers: { authorization: `Bearer ${token}` } })).status, 200);
      }],
      [{ ALCAZAR_API_TOKEN_FILE: join(secrets, 'operator.token') }, async (lines, base) => {
        assert.equal(lines.some((l) => l.signIn), false);
        assert.equal((await fetch(`${base}api/session`, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 200);
      }],
    ]) {
      const child = spawn(process.execPath, [join(ROOT, 'scripts', 'start-hardened.mjs')], {
        env: { ...process.env, ALCAZAR_HOST: '127.0.0.1', ALCAZAR_PORT: '0', ALCAZAR_WORK_DIR: work(), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const closed = new Promise((resolve) => child.on('close', resolve));
      try {
        const lines = await new Promise((resolve, reject) => {
          let out = '';
          child.stdout.on('data', (chunk) => {
            out += chunk;
            const parsed = out.split('\n').filter((l) => l.startsWith('{') && l.endsWith('}')).map((l) => JSON.parse(l));
            const listening = parsed.find((l) => l.message === 'Gatehouse listening');
            // The link, when there is one, is printed right after.
            if (listening && (env.ALCAZAR_API_TOKEN_FILE || parsed.some((l) => l.signIn))) resolve(parsed);
          });
          closed.then((code) => reject(new Error(`the launcher exited with ${code}`)));
        });
        await check(lines, lines.find((l) => l.message === 'Gatehouse listening').url);
      } finally {
        child.kill('SIGTERM');
        await closed;
      }
    }
  });
});
