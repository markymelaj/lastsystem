import { demoEnabled, provisionDemoUsers, send, serverClient, DEMO_USERS } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!demoEnabled()) return send(res, 404, { error: 'Demo no disponible.' });
  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }
  try {
    // Este endpoint corre en CADA clic de los botones de acceso demo.
    // Solo se registra en auditoría cuando realmente se crean cuentas
    // (la primera vez o tras un reset); si ya existían, no se ensucia
    // la trazabilidad con eventos repetidos.
    const emails = DEMO_USERS.map(item => item.email);
    const { data: existing } = await admin
      .from('user_profiles').select('id').in('email', emails).eq('active', true);
    const existedBefore = existing?.length || 0;

    await provisionDemoUsers(admin);

    if (existedBefore < emails.length) {
      await admin.from('audit_logs').insert({
        action: 'DEMO_USERS_READY',
        entity_table: 'user_profiles',
        metadata: { created: emails.length - existedBefore, total: emails.length },
        risk_level: 'normal'
      });
    }
    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, 400, { error: error.message || 'No se pudieron preparar los accesos demo.' });
  }
}
