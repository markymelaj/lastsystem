import {
  CLINICAL_ROLES, audit, canProvision, currentCaller, findUserByEmail,
  send, serverClient, validPassword
} from './_auth.js';

const INTERNAL_ROLES = new Set([
  'super_admin', 'direction', 'clinical_coordination', 'medical', 'psychologist',
  'social_worker', 'therapeutic_operator', 'professional', 'admission',
  'finance', 'communications', 'auditor'
]);
const clean = value => String(value || '').trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }
  const caller = await currentCaller(req, admin);
  if (caller.error) return send(res, caller.status, { error: caller.error });

  const body = req.body || {};
  const kind = clean(body.kind);
  const email = clean(body.email).toLowerCase();
  const fullName = clean(body.full_name);
  const password = String(body.password || '');
  const professionalId = body.professional_id || null;
  const patientId = body.patient_id || null;
  const requestedRole = clean(body.role_code);
  if (!email || !fullName || !validPassword(password)) {
    return send(res, 400, { error: 'Email, nombre y una contraseña de 12 caracteres con mayúscula, minúscula y número son obligatorios.' });
  }

  let roleCode;
  let accountKind;
  if (kind === 'patient') {
    roleCode = 'patient'; accountKind = 'patient';
    if (!patientId) return send(res, 400, { error: 'Debe vincular la cuenta con un paciente.' });
  } else if (kind === 'family') {
    roleCode = 'family'; accountKind = 'family';
    if (!Array.isArray(body.authorizations) || body.authorizations.length === 0) {
      return send(res, 400, { error: 'Debe indicar al menos una autorización familiar vigente.' });
    }
  } else if (kind === 'professional') {
    roleCode = requestedRole || 'professional'; accountKind = 'internal';
    if (!professionalId || !CLINICAL_ROLES.has(roleCode)) {
      return send(res, 400, { error: 'El profesional debe tener un rol clínico y una ficha vinculada.' });
    }
  } else if (kind === 'internal') {
    roleCode = requestedRole; accountKind = 'internal';
    if (!INTERNAL_ROLES.has(roleCode)) return send(res, 400, { error: 'Rol interno inválido.' });
  } else {
    return send(res, 400, { error: 'Tipo de cuenta inválido.' });
  }
  if (!canProvision(caller.profile, roleCode)) return send(res, 403, { error: 'No puede crear este tipo de cuenta.' });

  try {
    if (await findUserByEmail(admin, email)) {
      return send(res, 409, { error: 'Ya existe una cuenta con ese email. Use la gestión de accesos; una cuenta existente nunca se reasigna.' });
    }
    if (kind === 'family') {
      for (const item of body.authorizations) {
        const { patient_id: authorizationPatientId, patient_contact_id: contactId } = item || {};
        if (!authorizationPatientId || !contactId) return send(res, 400, { error: 'Cada autorización requiere paciente y contacto autorizado.' });
        const { data: contact } = await admin.from('patient_contacts')
          .select('id, patient_id, is_authorized, can_access_portal').eq('id', contactId).maybeSingle();
        if (!contact || contact.patient_id !== authorizationPatientId || !contact.is_authorized || !contact.can_access_portal) {
          return send(res, 400, { error: 'Uno de los contactos familiares no está autorizado para el portal.' });
        }
      }
    }

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: fullName, account_kind: accountKind, role_code: roleCode, must_change_password: true }
    });
    if (createError || !created?.user) return send(res, 400, { error: createError?.message || 'No se pudo crear la cuenta.' });
    const userId = created.user.id;
    const { error: profileError } = await admin.from('user_profiles').insert({
      id: userId, email, full_name: fullName, role_code: roleCode, account_kind: accountKind, active: true,
      professional_id: kind === 'professional' ? professionalId : null,
      patient_id: kind === 'patient' ? patientId : null
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(userId);
      return send(res, 400, { error: profileError.message });
    }

    if (kind === 'family') {
      const rows = body.authorizations.map(item => ({
        user_id: userId, patient_id: item.patient_id, patient_contact_id: item.patient_contact_id,
        relationship: clean(item.relationship) || null, can_view_profile: item.can_view_profile !== false,
        can_view_appointments: item.can_view_appointments !== false, can_receive_updates: item.can_receive_updates !== false,
        can_upload_documents: Boolean(item.can_upload_documents), can_view_documents: Boolean(item.can_view_documents),
        valid_until: item.valid_until || null, authorized_by: caller.user.id
      }));
      const { error: authorizationError } = await admin.from('family_authorizations').insert(rows);
      if (authorizationError) {
        await admin.from('user_profiles').delete().eq('id', userId);
        await admin.auth.admin.deleteUser(userId);
        return send(res, 400, { error: authorizationError.message });
      }
    }
    await audit(admin, caller.user.id, 'USER_PROVISIONED', 'user_profiles', userId, patientId, {
      account_kind: accountKind, role_code: roleCode
    }, 'high');
    return send(res, 201, { user_id: userId, email, role_code: roleCode, account_kind: accountKind });
  } catch (error) {
    return send(res, 500, { error: error.message || 'No se pudo crear la cuenta.' });
  }
}
