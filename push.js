/* PUSH OBAVIJESTI (Web Push, RFC 8291 + VAPID RFC 8292) bez vanjskih paketa.
   Obavijest stiže u Windows i kad prozor aplikacije nije otvoren (Chrome smije raditi u pozadini).
   vapid = {pub (base64url, 65 B), jwk (privatni ključ)} sprema se u db.vapid; pretplate su u db.push. */
const crypto = require('crypto'), https = require('https');
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function vapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  return { pub: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])), jwk };
}

function vapidAuth(vapid, endpoint, subject) {
  const aud = new URL(endpoint).origin, now = Math.floor(Date.now() / 1000);
  const data = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + b64u(JSON.stringify({ aud, exp: now + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: vapid.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + data + '.' + b64u(sig) + ', k=' + vapid.pub;
}

/* šifriranje sadržaja (aes128gcm, jedan zapis) */
function encrypt(sub, payload) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const as = ecdh.getPublicKey(), shared = ecdh.computeSecret(ua), salt = crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21); salt.copy(head, 0); head.writeUInt32BE(4096, 16); head.writeUInt8(65, 20);
  return Buffer.concat([head, as, body]);
}

/* pošalji jednu obavijest; vraća HTTP status (404/410 = pretplata više ne vrijedi) */
function send(vapid, sub, data, subject) {
  return new Promise(res => {
    let body; try { body = encrypt(sub, JSON.stringify(data)); } catch (e) { return res(400); }
    const u = new URL(sub.endpoint);
    const r = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST', timeout: 15000,
      headers: { TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, Authorization: vapidAuth(vapid, sub.endpoint, subject) } },
      x => { x.resume(); res(x.statusCode); });
    r.on('error', () => res(0)); r.on('timeout', () => { r.destroy(); res(0); }); r.end(body);
  });
}

module.exports = { vapidKeys, send, encrypt, b64u, unb64u };
