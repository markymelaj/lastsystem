import crypto from 'node:crypto';
import { audit, findUserByEmail, send, serverClient, validPassword } from './_auth.js';

function matches(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  const token = process.env.BOOTSTRAP_ADMIN_TOKEN;
  if (!token || !matches(req.headers['x-bootstrap-token'], token)) return send(res, 404, { error: 'No disponible' });
  const { email, password, full_name: fullName } = req.body || {};
  if (!email || !fullName || !validPassword(password)) {
    return send(res, 400, { error: 'Ingrese email, nombre y una contraseña segura de 12 caracteres o más.' });
  }
  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }
  const { count } = await admin.from('user_profiles').select('*', { count: 'exact', head: true });
  if (count > 0) return send(res, 409, { error: 'Ya existe una cuenta administradora. Desactive BOOTSTRAP_ADMIN_TOKEN.' });
  if (await findUserByEmail(admin, String(email).trim().toLowerCase())) return send(res, 409, { error: 'Ese email ya posee una cuenta.' });
  const { data, error } = await admin.auth.admin.createUser({
    email: String(email).trim().toLowerCase(), password, email_confirm: true,
    user_metadata: { full_name: String(fullName).trim(), account_kind: 'internal', role_code: 'super_admin', must_change_password: true }
  });
  if (error || !data?.user) return send(res, 400, { error: error?.message || 'No se pudo crear el administrador.' });
  const { error: profileError } = await admin.from('user_profiles').insert({
    id: data.user.id, email: String(email).trim().toLowerCase(), full_name: String(fullName).trim(),
    role_code: 'super_admin', account_kind: 'internal', active: true
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return send(res, 400, { error: profileError.message });
  }
  await audit(admin, data.user.id, 'BOOTSTRAP_ADMIN_PROVISIONED', 'user_profiles', data.user.id, null, {}, 'high');
  return send(res, 201, { ok: true });
}
