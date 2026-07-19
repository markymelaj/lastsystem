// Inicia la conexión del calendario de un profesional con Google.
// Solo Dirección / super_admin. Devuelve la URL de consentimiento de
// Google con un "state" firmado (HMAC) para validar el retorno.
import crypto from 'node:crypto';
import { send, serverClient, currentCaller } from './_auth.js';

function stateSecret() {
  return process.env.GOOGLE_OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}
export function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export function verifyState(state) {
  const [body, mac] = String(state || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  try {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return send(res, 400, { error: 'Google Calendar no está configurado todavía (faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Vercel).' });
    }
    const admin = serverClient();
    const caller = await currentCaller(req, admin);
    if (caller.error) return send(res, caller.status, { error: caller.error });
    if (!['super_admin', 'direction'].includes(caller.profile.role_code)) {
      return send(res, 403, { error: 'Solo Dirección puede conectar calendarios' });
    }
    const professionalId = String(req.body?.professional_id || '').trim();
    const { data: professional } = await admin.from('professionals').select('id, full_name').eq('id', professionalId).maybeSingle();
    if (!professional) return send(res, 404, { error: 'Profesional inexistente' });

    const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    const state = signState({ p: professional.id, t: Date.now() });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: `${origin}/api/calendar-google-callback`,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events openid email',
      access_type: 'offline',
      prompt: 'consent',
      state
    });
    return send(res, 200, { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (error) {
    return send(res, 500, { error: error.message || 'Error interno' });
  }
}
