// Emula lo mínimo de Supabase Auth + gateway para pruebas locales. NO es para producción.
import http from 'node:http';
import crypto from 'node:crypto';
const SECRET = 'secreto-local-de-prueba-de-32-caracteres-min';
const USUARIOS = {
  'admin@prueba.local': '00000000-0000-0000-0000-00000000000a',
  'bodega@prueba.local': '00000000-0000-0000-0000-00000000000b',
  'papa@prueba.local': '00000000-0000-0000-0000-000000000001',
  'hijo1@prueba.local': '00000000-0000-0000-0000-000000000002'
};
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, email) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
};
const userObj = (id, email) => ({ id, email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/auth/v1/token') {
    const { email, password } = JSON.parse(body.toString() || '{}');
    const id = USUARIOS[email];
    if (!id || password !== 'prueba123') { res.writeHead(400, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' })); }
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ access_token: jwt(id, email), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + id, user: userObj(id, email) }));
  }
  if (url.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  if (url.pathname === '/auth/v1/user') {
    const tok = (req.headers.authorization || '').split(' ')[1] || '';
    const p = JSON.parse(Buffer.from(tok.split('.')[1] || 'e30', 'base64url').toString());
    res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end(JSON.stringify(userObj(p.sub, p.email)));
  }
  if (url.pathname.startsWith('/rest/v1')) {
    const headers = { ...req.headers }; delete headers.host; delete headers.apikey;
    if (headers.authorization && !headers.authorization.includes('.')) delete headers.authorization; // anon key falsa
    const r = await fetch('http://127.0.0.1:3000' + url.pathname.slice(8) + url.search, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
    const out = Buffer.from(await r.arrayBuffer());
    const h = Object.fromEntries([...r.headers].filter(([k]) => !['content-encoding', 'transfer-encoding', 'content-length'].includes(k)));
    res.writeHead(r.status, { ...h, ...cors }); return res.end(out);
  }
  res.writeHead(404, cors); res.end();
}).listen(54321, () => console.log('mock en 54321'));
