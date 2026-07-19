// Retorno del consentimiento de Google. Verifica el "state" firmado,
// intercambia el código por tokens, cifra el refresh token (AES-256-GCM)
// y guarda la conexión del profesional como "connected".
import crypto from 'node:crypto';
import { serverClient } from './_auth.js';
import { verifyState } from './calendar-google-start.js';

export function tokenKey() {
  const raw = process.env.GOOGLE_TOKEN_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'senderos-dev-key';
  return crypto.createHash('sha256').update(raw).digest();
}
export function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}
export function decryptToken(ciphertext) {
  const [version, iv, tag, data] = String(ciphertext || '').split('.');
  if (version !== 'v1') throw new Error('Formato de token inválido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

export default async function handler(req, res) {
  const fail = (message) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(400).send(`<p style="font-family:sans-serif">No se pudo conectar el calendario: ${message}. Cerrá esta ventana y probá de nuevo desde el sistema.</p>`);
  };
  try {
    const { code, state, error: googleError } = req.query || {};
    if (googleError) return fail('la autorización fue rechazada');
    const payload = verifyState(state);
    if (!payload?.p) return fail('el enlace no es válido o expiró');
    if (Date.now() - Number(payload.t || 0) > 15 * 60 * 1000) return fail('el enlace expiró');

    const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code || ''),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${origin}/api/calendar-google-callback`,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token) return fail('Google no entregó credenciales (revocá el acceso previo en myaccount.google.com y reintentá)');

    let email = null;
    try {
      const claims = JSON.parse(Buffer.from(String(tokens.id_token || '').split('.')[1] || '', 'base64url').toString('utf8'));
      email = claims.email || null;
    } catch { /* opcional */ }

    const admin = serverClient();
    const { error } = await admin.from('calendar_connections').upsert({
      professional_id: payload.p,
      provider: 'google',
      calendar_id: 'primary',
      external_account_email: email,
      sync_direction: 'senderos_to_google',
      status: 'connected',
      token_ciphertext: encryptToken(tokens.refresh_token),
      last_error: null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'professional_id,provider' });
    if (error) return fail('no se pudo guardar la conexión');

    await admin.from('audit_logs').insert({
      action: 'CALENDAR_CONNECTED', entity_table: 'calendar_connections',
      metadata: { professional_id: payload.p, email }, risk_level: 'normal'
    });
    res.statusCode = 302;
    res.setHeader('Location', '/sistema/?gcal=ok');
    res.end();
  } catch (error) {
    return fail(error.message || 'error interno');
  }
}
