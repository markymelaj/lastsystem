// Sincronización con Google Calendar (cron cada 15 minutos).
// Drena calendar_sync_outbox y publica cada turno o sesión grupal como
// un evento "Reservado — Senderos" SIN datos clínicos ni nombres.
// Autenticación: header Authorization: Bearer ${CRON_SECRET} (Vercel Cron).
import { send, serverClient } from './_auth.js';
import { decryptToken } from './calendar-google-callback.js';

async function accessTokenFor(connection) {
  const refreshToken = decryptToken(connection.token_ciphertext);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'No se pudo refrescar el token de Google');
  return data.access_token;
}

async function googleFetch(token, path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (response.status === 204) return {};
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new Error(data?.error?.message || `Google respondió ${response.status}`);
  }
  return data;
}

async function findEvent(token, calendarId, key, value) {
  const params = new URLSearchParams({ privateExtendedProperty: `${key}=${value}`, maxResults: '1', showDeleted: 'false' });
  const data = await googleFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  return data.items?.[0] || null;
}

export default async function handler(req, res) {
  const auth = String(req.headers.authorization || '');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return send(res, 401, { error: 'No autorizado' });
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return send(res, 200, { ok: true, skipped: 'Google no configurado' });
  }
  const admin = serverClient();
  const results = { processed: 0, completed: 0, failed: 0, skipped: 0 };
  try {
    const { data: items } = await admin.from('calendar_sync_outbox')
      .select('*')
      .in('status', ['pending', 'failed'])
      .lte('available_at', new Date().toISOString())
      .lt('attempts', 5)
      .order('created_at')
      .limit(40);

    const tokenCache = new Map();
    for (const item of items || []) {
      results.processed += 1;
      try {
        // Resolver el registro de origen y su profesional.
        let professionalId = null; let startAt = null; let endAt = null; let cancelled = item.operation === 'cancel';
        let refKey = null; let refValue = null; let summary = 'Reservado — Senderos';
        if (item.appointment_id) {
          const { data: appointment } = await admin.from('appointments')
            .select('id, professional_id, start_at, end_at, status').eq('id', item.appointment_id).maybeSingle();
          if (!appointment) { await markDone(admin, item, 'completed', 'origen eliminado'); results.skipped += 1; continue; }
          professionalId = appointment.professional_id; startAt = appointment.start_at; endAt = appointment.end_at;
          cancelled = cancelled || ['cancelado', 'reprogramado'].includes(appointment.status);
          refKey = 'senderosAppointmentId'; refValue = appointment.id;
        } else if (item.group_session_id) {
          const { data: groupSession } = await admin.from('group_sessions')
            .select('id, professional_id, start_at, end_at, status').eq('id', item.group_session_id).maybeSingle();
          if (!groupSession) { await markDone(admin, item, 'completed', 'origen eliminado'); results.skipped += 1; continue; }
          professionalId = groupSession.professional_id; startAt = groupSession.start_at; endAt = groupSession.end_at;
          cancelled = cancelled || groupSession.status === 'cancelado';
          refKey = 'senderosGroupSessionId'; refValue = groupSession.id;
          summary = 'Espacio grupal — Senderos';
        } else {
          await markDone(admin, item, 'completed', 'sin origen'); results.skipped += 1; continue;
        }

        const { data: connection } = await admin.from('calendar_connections')
          .select('*').eq('professional_id', professionalId).eq('provider', 'google').eq('status', 'connected').maybeSingle();
        if (!connection?.token_ciphertext) { await markDone(admin, item, 'completed', 'profesional sin calendario conectado'); results.skipped += 1; continue; }

        if (!tokenCache.has(connection.id)) tokenCache.set(connection.id, await accessTokenFor(connection));
        const token = tokenCache.get(connection.id);
        const calendarId = connection.calendar_id || 'primary';
        const existing = await findEvent(token, calendarId, refKey, refValue);

        if (cancelled) {
          if (existing?.id) await googleFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events/${existing.id}`, { method: 'DELETE' });
        } else {
          const body = JSON.stringify({
            summary,
            description: 'Bloque reservado por el sistema de la Fundación Senderos de Libertad. Sin datos clínicos.',
            start: { dateTime: startAt },
            end: { dateTime: endAt },
            transparency: 'opaque',
            extendedProperties: { private: { [refKey]: String(refValue) } }
          });
          if (existing?.id) await googleFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events/${existing.id}`, { method: 'PATCH', body });
          else await googleFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body });
        }
        await admin.from('calendar_connections').update({ last_synced_at: new Date().toISOString(), last_error: null }).eq('id', connection.id);
        await markDone(admin, item, 'completed', null);
        results.completed += 1;
      } catch (itemError) {
        results.failed += 1;
        await admin.from('calendar_sync_outbox').update({
          status: 'failed',
          attempts: (item.attempts || 0) + 1,
          last_error: String(itemError.message || itemError).slice(0, 500),
          available_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        }).eq('id', item.id);
      }
    }
    return send(res, 200, { ok: true, ...results });
  } catch (error) {
    return send(res, 500, { error: error.message || 'Error interno', ...results });
  }
}

async function markDone(admin, item, status, note) {
  await admin.from('calendar_sync_outbox').update({
    status, processed_at: new Date().toISOString(), last_error: note
  }).eq('id', item.id);
}
