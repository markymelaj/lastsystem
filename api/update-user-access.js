import { audit, canManageAccess, currentCaller, send, serverClient, validPassword } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }
  const caller = await currentCaller(req, admin);
  if (caller.error) return send(res, caller.status, { error: caller.error });
  const { user_id: userId, active, password } = req.body || {};
  if (!userId || (typeof active !== 'boolean' && !password)) {
    return send(res, 400, { error: 'Indique una activación/desactivación o una nueva contraseña.' });
  }
  const { data: target, error: targetError } = await admin.from('user_profiles')
    .select('id, role_code').eq('id', userId).maybeSingle();
  if (targetError || !target) return send(res, 404, { error: 'Cuenta inexistente.' });
  if (!canManageAccess(caller.profile, target.role_code)) return send(res, 403, { error: 'No puede modificar esta cuenta.' });
  if (caller.user.id === userId && active === false) return send(res, 400, { error: 'No puede desactivar su propia cuenta.' });
  if (password && !validPassword(password)) {
    return send(res, 400, { error: 'La contraseña debe tener 12 caracteres e incluir mayúscula, minúscula y número.' });
  }
  try {
    if (typeof active === 'boolean') {
      const { error } = await admin.from('user_profiles').update({ active }).eq('id', userId);
      if (error) return send(res, 400, { error: error.message });
      const { error: authError } = await admin.auth.admin.updateUserById(userId, { ban_duration: active ? 'none' : '876000h' });
      if (authError) return send(res, 400, { error: authError.message });
    }
    if (password) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password, user_metadata: { must_change_password: true } });
      if (error) return send(res, 400, { error: error.message });
    }
    await audit(admin, caller.user.id, 'USER_ACCESS_UPDATED', 'user_profiles', userId, null, {
      active: typeof active === 'boolean' ? active : undefined, password_reset: Boolean(password)
    }, 'high');
    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, 500, { error: error.message || 'No se pudo actualizar el acceso.' });
  }
}
