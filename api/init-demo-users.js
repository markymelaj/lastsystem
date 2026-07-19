import { demoEnabled, provisionDemoUsers, send, serverClient, DEMO_USERS } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!demoEnabled()) return send(res, 404, { error: 'Demo no disponible.' });
  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }
  try {
    await provisionDemoUsers(admin);
    await admin.from('audit_logs').insert({ action: 'DEMO_USERS_READY', entity_table: 'user_profiles', metadata: { count: DEMO_USERS.length }, risk_level: 'normal' });
    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, 400, { error: error.message || 'No se pudieron preparar los accesos demo.' });
  }
}
