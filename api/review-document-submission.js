import { CLINICAL_ROLES, audit, currentCaller, send, serverClient } from './_auth.js';

async function canReview(admin, profile, patientId) {
  if (['super_admin', 'direction', 'clinical_coordination', 'admission'].includes(profile.role_code)) return true;
  if (!CLINICAL_ROLES.has(profile.role_code) || !profile.professional_id) return false;
  const { data } = await admin.from('patient_programs').select('id').eq('patient_id', patientId)
    .eq('responsible_professional_id', profile.professional_id).eq('status', 'activo').limit(1);
  return Boolean(data?.length);
}

function safeName(name) {
  return String(name || 'documento').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }
  const caller = await currentCaller(req, admin);
  if (caller.error) return send(res, caller.status, { error: caller.error });
  const { submission_id: submissionId, decision, reviewer_note: reviewerNote } = req.body || {};
  if (!submissionId || !['approved', 'rejected'].includes(decision)) {
    return send(res, 400, { error: 'Indique una presentación y una decisión válida.' });
  }
  const { data: submission, error } = await admin.from('portal_document_submissions')
    .select('*, document_requirements(document_type_id, title)').eq('id', submissionId).maybeSingle();
  if (error || !submission) return send(res, 404, { error: 'Presentación inexistente.' });
  if (!(await canReview(admin, caller.profile, submission.patient_id))) return send(res, 403, { error: 'No puede revisar esta presentación.' });
  if (submission.status !== 'submitted') return send(res, 409, { error: 'La presentación ya fue revisada.' });

  if (decision === 'rejected') {
    await admin.from('portal_document_submissions').update({
      status: 'rejected', reviewed_by: caller.user.id, reviewed_at: new Date().toISOString(), reviewer_note: reviewerNote || null
    }).eq('id', submission.id);
    await admin.from('document_requirements').update({ status: 'rejected' }).eq('id', submission.requirement_id);
    await audit(admin, caller.user.id, 'PORTAL_DOCUMENT_REJECTED', 'portal_document_submissions', submission.id, submission.patient_id, {}, 'normal');
    return send(res, 200, { ok: true, status: 'rejected' });
  }

  try {
    const { data: sourceFile, error: downloadError } = await admin.storage.from('portal-submissions').download(submission.file_path);
    if (downloadError || !sourceFile) return send(res, 400, { error: downloadError?.message || 'No se encontró el archivo subido.' });
    const destinationPath = submission.patient_id + '/' + Date.now() + '-' + safeName(submission.original_filename);
    const bytes = Buffer.from(await sourceFile.arrayBuffer());
    const { error: uploadError } = await admin.storage.from('clinical-documents').upload(destinationPath, bytes, {
      contentType: submission.mime_type || 'application/octet-stream', upsert: false
    });
    if (uploadError) return send(res, 400, { error: uploadError.message });
    const requirement = submission.document_requirements || {};
    const { data: document, error: documentError } = await admin.from('patient_documents').insert({
      patient_id: submission.patient_id, document_type_id: requirement.document_type_id || null,
      title: requirement.title || submission.original_filename, file_path: destinationPath,
      storage_bucket: 'clinical-documents', source: 'portal_submission', approved_submission_id: submission.id,
      mime_type: submission.mime_type, size_bytes: submission.size_bytes, visibility: 'private_administrative',
      status: 'validado', uploaded_by: caller.user.id
    }).select('id').single();
    if (documentError) return send(res, 400, { error: documentError.message });
    await admin.from('portal_document_submissions').update({
      status: 'approved', reviewed_by: caller.user.id, reviewed_at: new Date().toISOString(),
      reviewer_note: reviewerNote || null, approved_document_id: document.id
    }).eq('id', submission.id);
    await admin.from('document_requirements').update({ status: 'approved' }).eq('id', submission.requirement_id);
    await admin.storage.from('portal-submissions').remove([submission.file_path]);
    await audit(admin, caller.user.id, 'PORTAL_DOCUMENT_APPROVED', 'patient_documents', document.id, submission.patient_id, {
      submission_id: submission.id
    }, 'normal');
    return send(res, 200, { ok: true, status: 'approved', document_id: document.id });
  } catch (exception) {
    return send(res, 500, { error: exception.message || 'No se pudo aprobar la presentación.' });
  }
}
