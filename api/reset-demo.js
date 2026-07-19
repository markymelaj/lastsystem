import {
  audit, currentCaller, deleteDemoUsers, demoEnabled,
  provisionDemoUsers, send, serverClient
} from './_auth.js';

// Restaura la demostración al estado sembrado:
//   1. elimina las cuentas de demostración de Supabase Auth (arrastra su perfil),
//   2. limpia y vuelve a cargar los datos de ejemplo con reset_demo_data(),
//   3. recrea las cuentas de acceso de la demo.
// Disponible solo con ENABLE_DEMO_SETUP, fuera de producción y para dirección.
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  if (!demoEnabled()) return send(res, 404, { error: 'La restauración de demo no está disponible en este entorno.' });

  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }

  const caller = await currentCaller(req, admin);
  if (caller.error) return send(res, caller.status, { error: caller.error });
  if (!['super_admin', 'direction'].includes(caller.profile.role_code)) {
    return send(res, 403, { error: 'Solo dirección puede restaurar la demostración.' });
  }

  try {
    await deleteDemoUsers(admin);
    const { error: resetError } = await admin.rpc('reset_demo_data');
    if (resetError) return send(res, 400, { error: resetError.message });
    await provisionDemoUsers(admin);
    await audit(admin, caller.user.id, 'DEMO_RESET', 'organizations', null, null, {}, 'high');
    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, 500, { error: error.message || 'No se pudo restaurar la demostración.' });
  }
}
