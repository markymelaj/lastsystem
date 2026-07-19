import { CLINICAL_ROLES, audit, currentCaller, send, serverClient } from './_auth.js';

async function canDownload(admin, profile, userId, document) {
  const now = new Date().toISOString();
  if (profile.account_kind === 'patient') {
    const { data } = await admin.from('portal_document_releases').select('id').eq('document_id', document.id)
      .eq('patient_id', profile.patient_id).eq('released_to', 'patient').eq('active', true)
      .or('expires_at.is.null,expires_at.gt.' + now).limit(1);
    return Boolean(data?.length);
  }
  if (profile.account_kind === 'family') {
    const { data: authorization } = await admin.from('family_authorizations').select('id').eq('user_id', userId)
      .eq('patient_id', document.patient_id).eq('active', true).eq('can_view_documents', true)
      .or('valid_until.is.null,valid_until.gte.' + now.slice(0, 10)).limit(1);
    if (!authorization?.length) return false;
    const { data: release } = await admin.from('portal_document_releases').select('id').eq('document_id', document.id)
      .eq('released_to', 'family').eq('active', true)
      .or('recipient_user_id.is.null,recipient_user_id.eq.' + userId)
      .or('expires_at.is.null,expires_at.gt.' + now).limit(1);
    return Boolean(release?.length);
  }
  if (['super_admin', 'direction', 'clinical_coordination', 'admission'].includes(profile.role_code)) return true;
  if (CLINICAL_ROLES.has(profile.role_code) && profile.professional_id) {
    const { data } = await admin.from('patient_programs').select('id').eq('patient_id', document.patient_id)
      .eq('responsible_professional_id', profile.professional_id).eq('status', 'activo').limit(1);
    return Boolean(data?.length);
  }
  return false;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }
  const caller = await currentCaller(req, admin);
  if (caller.error) return send(res, caller.status, { error: caller.error });
  const documentId = req.body?.document_id;
  if (!documentId) return send(res, 400, { error: 'Documento requerido.' });
  const { data: document, error } = await admin.from('patient_documents')
    .select('id, patient_id, file_path, storage_bucket, title').eq('id', documentId).maybeSingle();
  if (error || !document?.file_path) return send(res, 404, { error: 'Documento no disponible.' });
  if (!(await canDownload(admin, caller.profile, caller.user.id, document))) return send(res, 403, { error: 'No tiene acceso a este documento.' });
  const { data, error: urlError } = await admin.storage.from(document.storage_bucket || 'clinical-documents').createSignedUrl(document.file_path, 60);
  if (urlError) return send(res, 400, { error: urlError.message });
  await admin.from('document_access_logs').insert({ document_id: document.id, patient_id: document.patient_id, accessed_by: caller.user.id, action: 'download' });
  await audit(admin, caller.user.id, 'DOCUMENT_DOWNLOADED', 'patient_documents', document.id, document.patient_id, {}, 'normal');
  return send(res, 200, { url: data.signedUrl });
}
