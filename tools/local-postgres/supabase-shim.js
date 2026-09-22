#!/usr/bin/env node
/**
 * A Supabase-shaped front door for a local PostgreSQL + PostgREST pair.
 *
 * LOCAL DEVELOPMENT ONLY. It exists so the whole product -- including the
 * authenticated professional side -- can be driven in a real browser without
 * Docker and without a cloud project. It is not a security boundary and must
 * never be exposed beyond localhost.
 *
 * What it provides:
 *   /rest/v1/*   forwarded to PostgREST with the prefix stripped
 *   /auth/v1/*   the handful of GoTrue endpoints supabase-js actually calls
 *
 * Passwords are checked against auth.users with pgcrypto, and the access token
 * is a real HS256 JWT carrying `sub` and `role=authenticated`, signed with the
 * same secret PostgREST verifies. Row Level Security therefore sees a genuine
 * auth.uid(): the authorization being exercised is the real thing.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const CONFIG = {
  port: Number(process.env.SHIM_PORT || 4300),
  postgrestPort: Number(process.env.POSTGREST_PORT || 3001),
  jwtSecret: process.env.JWT_SECRET || 'local-dev-only-jwt-secret-for-browser-testing-32c',
  psql: process.env.PSQL || 'psql',
  pgHost: process.env.PGHOST || '127.0.0.1',
  pgPort: process.env.PGPORT || '55432',
  pgUser: process.env.PGUSER || 'postgres',
  pgDatabase: process.env.PGDATABASE || 'booking_web',
};

const base64url = (value) => Buffer.from(value).toString('base64url');

function signJwt(payload) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const data = header + '.' + body;
  const signature = crypto.createHmac('sha256', CONFIG.jwtSecret).update(data).digest('base64url');
  return data + '.' + signature;
}

function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = crypto
    .createHmac('sha256', CONFIG.jwtSecret)
    .update(parts[0] + '.' + parts[1])
    .digest('base64url');
  if (expected !== parts[2]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Runs one single-column query through psql.
 *
 * Values go in as psql variables and are referenced as :'name', which psql
 * quotes as literals, so the shim never concatenates user input into SQL.
 */
function queryColumn(sql, variables = {}) {
  const args = [
    '-h', CONFIG.pgHost,
    '-p', String(CONFIG.pgPort),
    '-U', CONFIG.pgUser,
    '-d', CONFIG.pgDatabase,
    '-X', '-q', '-t', '-A',
    '-v', 'ON_ERROR_STOP=1',
  ];
  for (const [name, value] of Object.entries(variables)) {
    args.push('-v', name + '=' + value);
  }
  args.push('-f', '-');

  return execFileSync(CONFIG.psql, args, { encoding: 'utf8', input: sql })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const ONE_HOUR = 60 * 60;

function issueSession(userId, email) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = signJwt({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    email,
    iat: now,
    exp: now + ONE_HOUR,
  });

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: ONE_HOUR,
    expires_at: now + ONE_HOUR,
    refresh_token: base64url(userId),
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  };
}

function findUserByCredentials(email, password) {
  const rows = queryColumn(
    "select id::text from auth.users where lower(email) = lower(:'email')" +
      " and encrypted_password = extensions.crypt(:'password', encrypted_password)",
    { email, password },
  );
  return rows[0] || null;
}

function findUserById(id) {
  const rows = queryColumn("select email from auth.users where id = :'id'::uuid", { id });
  return rows[0] || null;
}

function send(res, status, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': '*',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw.length > 0 ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function handleAuth(req, res, url) {
  const path = url.pathname.replace('/auth/v1', '');

  if (path === '/token') {
    const grant = url.searchParams.get('grant_type');
    const body = await readBody(req);

    if (grant === 'refresh_token') {
      const userId = Buffer.from(String(body.refresh_token || ''), 'base64url').toString('utf8');
      const email = userId ? findUserById(userId) : null;
      if (!email) {
        return send(res, 400, { error: 'invalid_grant', error_description: 'Unknown refresh token' });
      }
      return send(res, 200, issueSession(userId, email));
    }

    const userId = findUserByCredentials(String(body.email || ''), String(body.password || ''));
    if (!userId) {
      // Same wording GoTrue uses, so the client maps it the same way.
      return send(res, 400, {
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
        message: 'Invalid login credentials',
      });
    }
    return send(res, 200, issueSession(userId, String(body.email)));
  }

  if (path === '/user') {
    const claims = verifyJwt((req.headers.authorization || '').replace(/^Bearer /i, ''));
    if (!claims) return send(res, 401, { message: 'Unauthorized' });
    return send(res, 200, issueSession(claims.sub, claims.email).user);
  }

  if (path === '/logout') {
    return send(res, 204, '');
  }

  return send(res, 200, {});
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    });
    res.end();
    return;
  }

  if (url.pathname.startsWith('/auth/v1')) {
    handleAuth(req, res, url).catch((error) => send(res, 500, { message: String(error) }));
    return;
  }

  const path = url.pathname.startsWith('/rest/v1')
    ? url.pathname.slice('/rest/v1'.length) + url.search
    : url.pathname + url.search;

  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: CONFIG.postgrestPort,
      method: req.method,
      path: path || '/',
      headers: { ...req.headers, host: '127.0.0.1:' + CONFIG.postgrestPort },
    },
    (up) => {
      res.writeHead(up.statusCode || 500, {
        ...up.headers,
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
        'access-control-expose-headers': '*',
      });
      up.pipe(res);
    },
  );

  upstream.on('error', (error) => send(res, 502, { message: String(error) }));
  req.pipe(upstream);
});

server.listen(CONFIG.port, '127.0.0.1', () => {
  process.stdout.write(
    'supabase shim on http://127.0.0.1:' + CONFIG.port +
      ' -> postgrest ' + CONFIG.postgrestPort +
      ', database ' + CONFIG.pgDatabase + '\n',
  );
});
