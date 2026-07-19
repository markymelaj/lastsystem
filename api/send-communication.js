import { audit, currentCaller, send, serverClient } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Método no permitido' });
  let admin;
  try { admin = serverClient(); } catch (error) { return send(res, 500, { error: error.message }); }
  const caller = await currentCaller(req, admin);
  if (caller.error) return send(res, caller.status, { error: caller.error });
  if (!['super_admin', 'direction', 'clinical_coordination', 'admission', 'communications'].includes(caller.profile.role_code)) {
    return send(res, 403, { error: 'No autorizado para enviar comunicados.' });
  }
  const body = req.body || {};
  const title = String(body.title || '').trim();
  const message = String(body.body || '').trim();
  const audience = String(body.audience || '');
  const channel = body.channel === 'email' ? 'email' : 'in_app';
  const patientId = body.patient_id || null;
  if (!title || !message || !['professionals', 'patients', 'families', 'patient_network'].includes(audience)) {
    return send(res, 400, { error: 'Complete título, mensaje y audiencia.' });
  }
  try {
    const recipients = new Map();
    if (audience === 'professionals') {
      const { data } = await admin.from('user_profiles').select('id').eq('account_kind', 'internal').not('professional_id', 'is', null).eq('active', true);
      (data || []).forEach(row => recipients.set(row.id, null));
    } else {
      if (!patientId && audience === 'patient_network') return send(res, 400, { error: 'La red de un paciente requiere seleccionar el paciente.' });
      if (audience === 'patients' || audience === 'patient_network') {
        let query = admin.from('user_profiles').select('id, patient_id').eq('account_kind', 'patient').eq('active', true);
        if (patientId) query = query.eq('patient_id', patientId);
        const { data } = await query;
        (data || []).forEach(row => recipients.set(row.id, row.patient_id));
      }
      if (audience === 'families' || audience === 'patient_network') {
        let query = admin.from('family_authorizations').select('user_id, patient_id').eq('active', true).eq('can_receive_updates', true);
        if (patientId) query = query.eq('patient_id', patientId);
        const { data } = await query;
        (data || []).forEach(row => recipients.set(row.user_id, row.patient_id));
      }
    }
    if (!recipients.size) return send(res, 400, { error: 'No hay destinatarios activos para esa audiencia.' });
    const { data: communication, error } = await admin.from('communications').insert({
      title, body: message, audience, patient_id: patientId, channel, status: 'sent', sent_at: new Date().toISOString(), created_by: caller.user.id
    }).select('id').single();
    if (error) return send(res, 400, { error: error.message });
    const rows = [...recipients.entries()].map(([userId, recipientPatientId]) => ({
      communication_id: communication.id, user_id: userId, patient_id: recipientPatientId,
      channel, delivery_status: channel === 'in_app' ? 'sent' : 'queued',
      delivered_at: channel === 'in_app' ? new Date().toISOString() : null
    }));
    const { error: recipientError } = await admin.from('communication_recipients').insert(rows);
    if (recipientError) return send(res, 400, { error: recipientError.message });
    await audit(admin, caller.user.id, 'COMMUNICATION_SENT', 'communications', communication.id, patientId, {
      audience, channel, recipient_count: rows.length
    }, 'normal');
    return send(res, 201, { id: communication.id, recipients: rows.length, email_delivery: channel === 'email' ? 'queued_for_provider' : 'not_requested' });
  } catch (error) {
    return send(res, 500, { error: error.message || 'No se pudo enviar el comunicado.' });
  }
}
