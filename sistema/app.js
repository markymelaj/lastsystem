const app = document.getElementById('app');
let sb; let session; let profile; let config = {}; let activeTab = 'dashboard';
let state = emptyState();
let selectedGroupId = null;

const roles = [
  ['direction','Dirección'], ['clinical_coordination','Coordinación clínica'],
  ['medical','Médico/a'], ['psychologist','Psicología'], ['social_worker','Trabajo social'],
  ['therapeutic_operator','Operador/a terapéutico'], ['professional','Profesional clínico'],
  ['admission','Admisión'], ['finance','Finanzas'], ['communications','Comunicaciones'],
  ['auditor','Auditoría'], ['patient','Paciente'], ['family','Familiar autorizado']
];
const tabs = [
  ['dashboard','Inicio'], ['patients','Pacientes'], ['professionals','Profesionales'],
  ['schedule','Agenda'], ['groups','Grupos y talleres'], ['clinical','Historia clínica'],
  ['documents','Documentos'], ['programs','Programas'], ['access','Accesos'],
  ['finance','Pagos'], ['communications','Comunicados'], ['audit','Auditoría']
];

function emptyState() {
  return {
    patients:[], contacts:[], professionals:[], programs:[], appointmentTypes:[], rooms:[],
    appointments:[], availability:[], blocks:[], clinical:[], documents:[], documentTypes:[],
    requirements:[], submissions:[], profiles:[], charges:[], payments:[], audit:[],
    groups:[], groupEnrollments:[], patientPrograms:[], calendarConnections:[]
  };
}
function esc(value='') { return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char])); }
function name(person) { return person ? `${person.first_name || ''} ${person.last_name || ''}`.trim() : '-'; }
function roleName(code) { return (roles.find(row => row[0] === code) || [code])[1]; }
function tag(value, kind='') { return `<span class="tag ${kind}">${esc(value || '-')}</span>`; }
function dateTime(value) { return value ? new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '-'; }
function timeShort(value) { return value ? new Date(value).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}) : '-'; }
function localDateKey(value) { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function money(value,currency='ARS') { return `${currency} ${Number(value || 0).toLocaleString('es-AR')}`; }
function table(headers, rows) {
  if (!rows.length) return '<div class="empty">Sin registros</div>';
  return `<div class="table-wrap"><table><thead><tr>${headers.map(header => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function selectOptions(items, label, includeBlank=false) {
  return `${includeBlank ? '<option value="">Sin asignar</option>' : ''}${items.map(item => `<option value="${item.id}">${esc(label(item))}</option>`).join('')}`;
}
function field(key,label,type='text',required=false,extra='') {
  return `<label class="field">${label}<input name="${key}" type="${type}" ${required ? 'required' : ''} ${extra}></label>`;
}
function pick(form, keys) {
  const values = {}; const data = new FormData(form);
  keys.forEach(key => { values[key] = data.get(key) || null; });
  return values;
}
function isAdmin() { return ['super_admin','direction','clinical_coordination'].includes(profile?.role_code); }
function canFinance() { return ['super_admin','direction','finance'].includes(profile?.role_code); }
function canCommunicate() { return ['super_admin','direction','clinical_coordination','admission','communications'].includes(profile?.role_code); }
function canManageDocuments() { return ['super_admin','direction','clinical_coordination','admission','professional','medical','psychologist','social_worker','therapeutic_operator'].includes(profile?.role_code); }
function canSchedule() { return ['super_admin','direction','clinical_coordination','admission','professional','medical','psychologist','social_worker','therapeutic_operator'].includes(profile?.role_code); }
function isClinicalRole() { return ['professional','medical','psychologist','social_worker','therapeutic_operator'].includes(profile?.role_code); }
function isAdminRole() { return ['super_admin','direction'].includes(profile?.role_code); }
function assignedPatientIds() {
  if (!isClinicalRole() || !profile?.professional_id) return null;
  const ids = new Set();
  state.patientPrograms.filter(item=>item.responsible_professional_id===profile.professional_id && item.status==='activo').forEach(item=>ids.add(item.patient_id));
  state.appointments.filter(item=>item.professional_id===profile.professional_id && !['cancelado','reprogramado'].includes(item.status)).forEach(item=>ids.add(item.patient_id));
  return ids;
}
function scopedPatients() {
  const ids = assignedPatientIds();
  return ids ? state.patients.filter(item=>ids.has(item.id)) : state.patients;
}

// Traduce los errores técnicos de Postgres/Supabase a mensajes operables.
function friendly(error) {
  const raw = String(error?.message || error || '');
  if (/row-level security/i.test(raw)) return 'Tu rol no tiene permiso para esta acción, o el paciente no está asignado a tu perfil.';
  if (/appointments_no_professional_overlap|duplicate key.*overlap/i.test(raw)) return 'El profesional ya tiene un turno en ese horario.';
  if (/mime type|not supported/i.test(raw)) return 'Formato no admitido. Subí PDF, JPG, PNG o WebP (hasta 10 MB).';
  if (/payload too large|exceeded the maximum/i.test(raw)) return 'El archivo supera el tamaño máximo de 10 MB.';
  if (/JWT|token/i.test(raw) && /expired/i.test(raw)) return 'La sesión expiró. Volvé a ingresar.';
  if (/violates check constraint/i.test(raw)) return 'Alguno de los datos no es válido. Revisá el formulario.';
  if (/duplicate key/i.test(raw)) return 'Ya existe un registro con esos datos.';
  return raw || 'No se pudo completar la acción.';
}

// ---------------------------------------------------------------
// Iconografía de navegación (SVG en línea, sin dependencias)
// ---------------------------------------------------------------
const ICONS = {
  dashboard:'<path d="M3 13h8V3H3v10Zm0 8h8v-6H3v6Zm10 0h8V11h-8v10Zm0-18v6h8V3h-8Z"/>',
  patients:'<path d="M16 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.7 0-8 1.3-8 4v3h8m8-7c-.6 0-1.3 0-2 .1 1.6.9 2 2 2 2.9V20h8v-3c0-2.7-5.3-4-8-4Z"/>',
  professionals:'<path d="M12 2 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-4Zm-1 13-3-3 1.4-1.4L11 12.2l4.6-4.6L17 9l-6 6Z"/>',
  schedule:'<path d="M7 2v3M17 2v3M3 8h18M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm2 8h4v4H7Z"/>',
  groups:'<path d="M12 5a3 3 0 1 1-3 3 3 3 0 0 1 3-3Zm-7 3a2.5 2.5 0 1 1-2.5 2.5A2.5 2.5 0 0 1 5 8Zm14 0a2.5 2.5 0 1 1-2.5 2.5A2.5 2.5 0 0 1 19 8ZM12 13c2.9 0 6 1.4 6 4v3H6v-3c0-2.6 3.1-4 6-4ZM4.6 14.4C2.7 14.9 1 16 1 17.5V20h3v-3c0-1 .2-1.9.6-2.6Zm14.8 0c.4.7.6 1.6.6 2.6v3h3v-2.5c0-1.5-1.7-2.6-3.6-3.1Z"/>',
  clinical:'<path d="M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1Zm2 8v2H9v2h2v2h2v-2h2v-2h-2v-2h-2Z"/>',
  documents:'<path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V8h4.5M8 13h8v2H8Zm0 4h8v2H8Z"/>',
  programs:'<path d="M4 4h16v4H4V4Zm0 6h16v4H4v-4Zm0 6h10v4H4v-4Z"/>',
  access:'<path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 0 1 6 0v3H9Zm3 4a2 2 0 0 1 1 3.7V20h-2v-2.3A2 2 0 0 1 12 14Z"/>',
  finance:'<path d="M12 2C6.5 2 2 4 2 6.5v11C2 20 6.5 22 12 22s10-2 10-4.5v-11C22 4 17.5 2 12 2Zm0 2c4.7 0 8 1.6 8 2.5S16.7 11 12 11 4 9.4 4 6.5 7.3 4 12 4Zm0 16c-4.7 0-8-1.6-8-2.5v-2.2C5.8 14.4 8.7 15 12 15s6.2-.6 8-1.7v2.2c0 .9-3.3 2.5-8 2.5Z"/>',
  communications:'<path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 5h10v2H7Zm0 4h7v2H7Z"/>',
  audit:'<path d="M11 2a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 11 2Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-1 2v4l3 2 .8-1.3-2.3-1.4V6Z"/>',
  manual:'<path d="M6 2h11a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 16v2h11a1 1 0 0 0 1-1v-1H6Zm2-12h8v2H8Zm0 4h8v2H8Z"/>'
};
function navIcon(id){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[id]||''}</svg>`; }

// ---------------------------------------------------------------
// Guía in-app por rol.
// ---------------------------------------------------------------
const GUIDES = {
  direction:{ title:'Guía para Dirección',
    intro:'Tenés la vista completa: personas acompañadas, equipo, agenda, grupos, historia clínica, documentos, pagos, comunicados y auditoría.',
    steps:[
      ['Mirá el tablero','En Inicio ves de un vistazo personas activas, próximos turnos, grupos y talleres, documentación pendiente y cargos abiertos.'],
      ['Dá de alta a una persona','En Pacientes cargás la ficha, asignás programa y profesional responsable, y podés registrar al familiar referente.'],
      ['Sumá al equipo','En Profesionales cargás cada integrante y desde Accesos le creás su cuenta. Recordá cargar su disponibilidad en Agenda para que se le puedan asignar turnos.'],
      ['Agenda con horarios reales','Al agendar un turno elegís día y el sistema muestra solo los horarios libres del profesional: descuenta turnos, bloqueos y grupos.'],
      ['Publicá talleres y grupos','En Grupos y talleres creás cada espacio con cupo; los abiertos aparecen en el portal para que las personas se inscriban solas.'],
      ['Consultá el Manual','El botón Manual de uso, abajo a la izquierda, tiene el paso a paso completo de administración y del equipo profesional.']
    ]},
  clinical_coordination:{ title:'Guía para Coordinación clínica',
    intro:'Coordinás pacientes, equipo, tratamientos, agenda, grupos e historia clínica.',
    steps:[
      ['Revisá el tablero','En Inicio seguís turnos próximos, grupos y pendientes de documentación.'],
      ['Ordená los programas','En Programas definís y ajustás los dispositivos terapéuticos y sus etapas.'],
      ['Asigná responsables','Desde Pacientes vinculás cada persona con su programa y profesional tratante.'],
      ['Armá la agenda grupal','En Grupos y talleres publicás terapia grupal y talleres con cupo, y llevás la asistencia de cada encuentro.'],
      ['Seguí la clínica','En Historia clínica registrás y consultás evoluciones; los registros firmados quedan protegidos.']
    ]},
  clinical:{ title:'Guía para el equipo clínico',
    intro:'Trabajás con las personas que tenés asignadas: su agenda, sus grupos, sus documentos y su historia clínica.',
    steps:[
      ['Mirá tu agenda','En Agenda ves tus turnos y marcás asistencia, ausencia o reprogramación. Para agendar, elegí el día y tocá un horario libre.'],
      ['Cargá tu disponibilidad','En Agenda definís tus días y franjas de atención; sin disponibilidad cargada no se te pueden asignar turnos.'],
      ['Llevá tus grupos','En Grupos y talleres ves tus espacios grupales, inscribís participantes y marcás la asistencia.'],
      ['Registrá la evolución','En Historia clínica creás un borrador y, cuando esté listo, lo firmás. Una vez firmado no se edita: se rectifica.'],
      ['Cuidá la confidencialidad','Solo ves y cargás documentos de las personas que tenés asignadas o con quienes tenés turnos.']
    ]},
  admission:{ title:'Guía para Admisión y recepción',
    intro:'Sos la puerta de entrada: alta de personas, turnos, grupos y documentación.',
    steps:[
      ['Registrá el ingreso','En Pacientes completás la ficha y sumás al familiar referente.'],
      ['Agendá el primer turno','En Agenda elegís profesional, tipo y día; el sistema muestra solo los horarios libres y evita superposiciones.'],
      ['Inscribí a los grupos','En Grupos y talleres anotás a cada persona en los espacios con cupo disponible.'],
      ['Solicitá documentación','En Documentos pedís lo que la persona debe subir por el portal y revisás lo recibido.']
    ]},
  finance:{ title:'Guía para Administración',
    intro:'Gestionás cargos, pagos, becas y convenios de forma manual y trazable.',
    steps:[
      ['Creá un cargo','En Pagos registrás un aporte, convenio o donación, con o sin persona asociada.'],
      ['Registrá el pago','Cargás pagos parciales o totales; el saldo y el estado se concilian solos.'],
      ['Seguí los saldos','La tabla de cargos muestra montos, pagado y estado. Los pagos no se borran: se revierten.']
    ]},
  communications:{ title:'Guía para Comunicaciones',
    intro:'Emitís comunicados institucionales a profesionales, personas o familias.',
    steps:[
      ['Elegí la audiencia','Profesionales, pacientes, familias autorizadas o la red de una persona.'],
      ['Redactá sin datos clínicos','Los comunicados no incluyen información clínica sensible.'],
      ['Enviá y hacé seguimiento','El envío en el portal es inmediato; el correo queda en cola hasta configurar el proveedor.']
    ]},
  auditor:{ title:'Guía para Auditoría',
    intro:'Controlás la operación y la trazabilidad sin acceder a la historia clínica ni a documentos clínicos.',
    steps:[
      ['Revisá el tablero','Ves indicadores de operación de solo lectura.'],
      ['Consultá pacientes y agenda','Accedés a la información operativa: personas, profesionales, turnos, grupos y programas.'],
      ['Auditá la actividad','En Auditoría revisás cada acción registrada, con su rol y nivel de riesgo.']
    ]}
};
function guideFor(role){
  if (GUIDES[role]) return GUIDES[role];
  if (['professional','medical','psychologist','social_worker','therapeutic_operator'].includes(role)) return GUIDES.clinical;
  return GUIDES.direction;
}

// ---------------------------------------------------------------
// Manual integrado: paso a paso completo para administración
// y para el equipo profesional. Se abre desde la barra lateral.
// ---------------------------------------------------------------
const MANUAL = [
  { id:'m-admin', audience:'Administración y Dirección', sections:[
    { title:'Accesos y cuentas', body:[
      'En Accesos se crea cada cuenta nueva: paciente, familiar autorizado, profesional clínico o administración interna. Las cuentas nunca se reasignan; si alguien deja la institución, se desactiva.',
      'La contraseña temporal debe tener 12 caracteres con mayúscula, minúscula y número. Con "Restablecer" se entrega una nueva contraseña temporal.',
      'El familiar autorizado se vincula a un contacto marcado como autorizado en la ficha del paciente, y se define si puede ver o subir documentos.'
    ]},
    { title:'Agenda y disponibilidad', body:[
      'Antes de asignar turnos a un profesional, cargá su disponibilidad en Agenda → Disponibilidad profesional (día, franja horaria y desde cuándo rige). Sin disponibilidad, el sistema no ofrece horarios.',
      'Para agendar: elegí paciente, profesional, tipo de turno y día. El calendario muestra solo los horarios libres; los ocupados por turnos, bloqueos o grupos no aparecen.',
      'Los bloqueos (licencias, reuniones, feriados) se cargan en Bloquear horario y sacan esa franja de la oferta de turnos.'
    ]},
    { title:'Grupos y talleres', body:[
      'En Grupos y talleres se publica cada taller o espacio de terapia grupal: título, profesional a cargo, sala, cupo, día y horario.',
      'Si el espacio queda "abierto en el portal", las personas en tratamiento pueden inscribirse solas hasta agotar el cupo. Si no, la inscripción se hace desde el sistema.',
      'Al seleccionar una sesión se ven los inscriptos, se suman participantes y se marca asistencia. Cancelar una sesión avisa a la agenda y libera el horario.'
    ]},
    { title:'Pagos', body:[
      'En Pagos se crean cargos (aportes, convenios, donaciones) y se registran los pagos recibidos. El saldo se concilia solo: abierto, parcial o pagado.',
      'Los pagos no se eliminan; ante un error se registra la corrección para conservar la trazabilidad.'
    ]},
    { title:'Comunicados y auditoría', body:[
      'Los comunicados llegan al portal de la audiencia elegida. No deben incluir información clínica.',
      'Auditoría registra cada acción con responsable, rol y nivel de riesgo. Auditoría no accede a historia clínica ni documentos clínicos.'
    ]},
    { title:'Google Calendar', body:[
      'Desde Agenda → Google Calendar, Dirección conecta el calendario de cada profesional con el botón Conectar. Los turnos y grupos se publican como "Reservado", sin datos clínicos ni nombres.',
      'El sistema es siempre la fuente de verdad: lo que se ve en Google es un reflejo, y se actualiza cada 15 minutos.'
    ]},
    { title:'Demostración', body:[
      'Con ENABLE_DEMO_SETUP activo, el botón Restaurar demo vuelve todo al estado de ejemplo: datos, agenda, grupos y cuentas de prueba. Ideal antes de una presentación.'
    ]}
  ]},
  { id:'m-prof', audience:'Equipo profesional', sections:[
    { title:'Tu día en el sistema', body:[
      'Al ingresar, Inicio muestra tus próximos turnos y grupos. En Agenda marcás asistido, ausente, cancelado o reprogramado en cada turno.',
      'Solo ves a las personas que tenés asignadas como responsable o con quienes tenés turnos: la confidencialidad la aplica el propio sistema.'
    ]},
    { title:'Tu disponibilidad', body:[
      'Cargá en Agenda tus días y franjas de atención. Esa disponibilidad define qué horarios puede ofrecer recepción y qué puede reservar cada persona desde el portal.',
      'Si te tomás licencia o tenés una reunión, cargá un bloqueo: esa franja deja de ofrecerse automáticamente.'
    ]},
    { title:'Agendar un turno', body:[
      'Elegí paciente, tipo de turno y día: vas a ver únicamente tus horarios libres. Tocá el horario y confirmá. El sistema impide superposiciones con otros turnos, bloqueos y grupos.'
    ]},
    { title:'Grupos y talleres', body:[
      'En Grupos y talleres ves tus espacios grupales. Podés crear un taller o grupo propio, inscribir participantes y, al finalizar, marcar la asistencia de cada persona.'
    ]},
    { title:'Historia clínica', body:[
      'Creá la evolución como borrador y firmala cuando esté completa. Un registro firmado no se edita: si hay un error, se rectifica con un nuevo registro que queda vinculado.'
    ]},
    { title:'Documentos', body:[
      'Cargá informes en PDF o imagen (hasta 10 MB) de tus pacientes asignados. Con "Liberar al paciente" el documento aparece en su portal.',
      'En Solicitar documentación pedís lo que la persona o su familia debe subir; lo recibido se revisa y aprueba antes de entrar al legajo.'
    ]}
  ]}
];
function manualHtml(){
  const nav = MANUAL.map(group=>`<div class="manual-group"><p class="manual-aud">${esc(group.audience)}</p>${group.sections.map((section,index)=>`<button class="manual-link" data-manual-goto="${group.id}-${index}">${esc(section.title)}</button>`).join('')}</div>`).join('');
  const body = MANUAL.map(group=>`<section class="manual-block"><h3>${esc(group.audience)}</h3>${group.sections.map((section,index)=>`<article id="${group.id}-${index}" class="manual-article"><h4>${esc(section.title)}</h4>${section.body.map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}</article>`).join('')}</section>`).join('');
  return `<div class="modal-overlay manual-overlay" id="manualModal"><div class="modal manual-modal">
    <div class="modal-top manual-top"><div><p class="eyebrow">Manual de uso integrado</p><h2>Administración y equipo profesional</h2></div><button class="help-close" data-manual-close aria-label="Cerrar">&times;</button></div>
    <div class="manual-body"><nav class="manual-nav">${nav}<a class="btn secondary full" href="/assets/guia-senderos.pdf" target="_blank" rel="noopener">Mini guía (PDF)</a></nav><div class="manual-content">${body}</div></div>
  </div></div>`;
}
function openManual(){
  const host=document.getElementById('manualHost'); if(!host)return;
  host.innerHTML=manualHtml();
  const overlay=document.getElementById('manualModal');
  requestAnimationFrame(()=>overlay.classList.add('open'));
  const dismiss=()=>{overlay.classList.remove('open');setTimeout(()=>host.innerHTML='',200);};
  overlay.querySelector('[data-manual-close]').addEventListener('click',dismiss);
  overlay.addEventListener('click',event=>{if(event.target===overlay)dismiss();});
  overlay.querySelectorAll('[data-manual-goto]').forEach(button=>button.addEventListener('click',()=>{
    overlay.querySelector(`#${button.dataset.manualGoto}`)?.scrollIntoView({behavior:'smooth',block:'start'});
  }));
}

function helpPanelHtml(){
  const g = guideFor(profile?.role_code);
  const steps = g.steps.map((s,i)=>`<div class="help-step"><span class="n">${i+1}</span><h4>${esc(s[0])}</h4><p>${esc(s[1])}</p></div>`).join('');
  const reset = isAdminRole() && config.demoEnabled ? `<button class="btn danger full" data-demo-reset>Restaurar la demostración</button>` : '';
  return `<div class="help-overlay" data-help-overlay></div><aside class="help-panel" id="helpPanel" aria-label="Guía de uso">
    <div class="help-head"><div><p class="eyebrow">Guía de uso</p><h2>${esc(g.title)}</h2></div><button class="help-close" data-help-close aria-label="Cerrar">&times;</button></div>
    <div class="help-body"><p class="help-intro">${esc(g.intro)}</p>${steps}</div>
    <div class="help-foot"><button class="btn secondary full" data-manual-open>Abrir el manual completo</button><a class="btn ghost full" href="/assets/guia-senderos.pdf" target="_blank" rel="noopener">Descargar mini guía (PDF)</a>${reset}<p class="help-cred">Sistema de la Fundación Senderos de Libertad</p></div>
  </aside>`;
}
function welcomeModalHtml(){
  const g = guideFor(profile?.role_code);
  const bullets = g.steps.slice(0,3).map(s=>`<li>${esc(s[0])}</li>`).join('');
  return `<div class="modal-overlay" id="welcomeModal"><div class="modal">
    <div class="modal-top"><p class="eyebrow">Te damos la bienvenida</p><h2>${esc(g.title)}</h2></div>
    <div class="modal-body"><p>${esc(g.intro)}</p><ul class="modal-list">${bullets}</ul>
    <p class="muted">Podés reabrir esta guía desde el botón <strong>Guía</strong>, y el paso a paso completo vive en <strong>Manual de uso</strong>.</p></div>
    <div class="modal-foot"><span class="grow">Rol actual: ${esc(roleName(profile.role_code))}</span>
    <button class="btn secondary" data-welcome-close>Explorar por mi cuenta</button>
    <button class="btn primary" data-welcome-guide>Ver la guía paso a paso</button></div>
  </div></div>`;
}
function welcomeKey(){ return `senderos_welcome_${profile?.role_code||'x'}`; }
function maybeShowWelcome(){
  try { if (localStorage.getItem(welcomeKey())) return; } catch(e){}
  const host = document.getElementById('modalHost'); if (!host) return;
  host.innerHTML = welcomeModalHtml();
  const overlay = document.getElementById('welcomeModal');
  requestAnimationFrame(()=>overlay.classList.add('open'));
  const dismiss = ()=>{ try{ localStorage.setItem(welcomeKey(),'1'); }catch(e){} overlay.classList.remove('open'); setTimeout(()=>host.innerHTML='',200); };
  overlay.querySelector('[data-welcome-close]').addEventListener('click',dismiss);
  overlay.addEventListener('click',e=>{ if(e.target===overlay) dismiss(); });
  overlay.querySelector('[data-welcome-guide]').addEventListener('click',()=>{ dismiss(); openHelp(); });
}
function openHelp(){ const p=document.getElementById('helpPanel'); const o=document.querySelector('[data-help-overlay]'); p?.classList.add('open'); o?.classList.add('open'); }
function closeHelp(){ const p=document.getElementById('helpPanel'); const o=document.querySelector('[data-help-overlay]'); p?.classList.remove('open'); o?.classList.remove('open'); }
async function resetDemo(){
  if (!confirm('Esto vuelve la demostración al estado de ejemplo y elimina todo lo que se haya cargado durante la prueba. ¿Continuar?')) return;
  notice('Restaurando la demostración…');
  const response = await api('/api/reset-demo', {});
  if (!response.ok) return notice(response.error||'No se pudo restaurar.','error');
  await load(); render(); notice('Demostración restaurada al estado de ejemplo.');
}

init();
async function init() {
  try {
    const response = await fetch('/api/public-config');
    config = await response.json();
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error('Faltan variables públicas de Supabase.');
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth:{persistSession:true,autoRefreshToken:true} });
    const { data } = await sb.auth.getSession(); session = data.session;
    sb.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      if (session) await load();
      else { profile = null; state = emptyState(); }
      render();
    });
    if (session) await load();
    render();
    if (new URLSearchParams(location.search).get('gcal')==='ok') notice('Google Calendar conectado correctamente.');
  } catch (error) {
    app.innerHTML = `<main class="login-wrap"><section class="login-card"><h1>Sistema no configurado</h1><p>${esc(error.message)}</p></section></main>`;
  }
}

async function loadTable(query) {
  const result = await query;
  return result.error ? [] : (result.data || []);
}
async function load() {
  const result = await sb.from('user_profiles').select('*').eq('id',session.user.id).maybeSingle();
  profile = result.data || null;
  if (!profile || profile.account_kind !== 'internal') return;
  const queries = await Promise.all([
    loadTable(sb.from('patients').select('*').is('deleted_at',null).order('last_name').limit(500)),
    loadTable(sb.from('patient_contacts').select('*').order('full_name').limit(500)),
    loadTable(sb.from('professionals').select('*').eq('active',true).order('full_name')),
    loadTable(sb.from('programs').select('*').eq('active',true).order('name')),
    loadTable(sb.from('appointment_types').select('*').eq('active',true).order('name')),
    loadTable(sb.from('rooms').select('*').eq('active',true).order('name')),
    loadTable(sb.from('appointments').select('*, patients(first_name,last_name), professionals(full_name), appointment_types(name), rooms(name)').order('start_at').limit(500)),
    loadTable(sb.from('professional_availability_rules').select('*, professionals(full_name), rooms(name)').eq('active',true).order('weekday')),
    loadTable(sb.from('calendar_blocks').select('*, professionals(full_name), rooms(name)').eq('active',true).order('start_at').limit(300)),
    loadTable(sb.from('clinical_entries').select('*, patients(first_name,last_name), professionals(full_name)').is('deleted_at',null).order('created_at',{ascending:false}).limit(300)),
    loadTable(sb.from('patient_documents').select('*, patients(first_name,last_name), document_types(name)').order('created_at',{ascending:false}).limit(300)),
    loadTable(sb.from('document_types').select('*').eq('active',true).order('name')),
    loadTable(sb.from('document_requirements').select('*, patients(first_name,last_name), document_types(name)').order('created_at',{ascending:false}).limit(300)),
    loadTable(sb.from('portal_document_submissions').select('*, document_requirements(title), patients(first_name,last_name)').order('created_at',{ascending:false}).limit(300)),
    loadTable(sb.from('user_profiles').select('*').order('created_at',{ascending:false}).limit(500)),
    loadTable(sb.from('financial_charges').select('*, patients(first_name,last_name)').order('created_at',{ascending:false}).limit(300)),
    loadTable(sb.from('financial_payments').select('*, financial_charges(description), patients(first_name,last_name)').order('paid_at',{ascending:false}).limit(300)),
    loadTable(sb.from('audit_logs').select('*').order('created_at',{ascending:false}).limit(300)),
    loadTable(sb.from('group_sessions').select('*, professionals(full_name), programs(name), rooms(name)').neq('status','x').order('start_at').limit(300)),
    loadTable(sb.from('group_session_enrollments').select('*, patients(first_name,last_name), group_sessions(title,start_at)').order('created_at',{ascending:false}).limit(600)),
    loadTable(sb.from('patient_programs').select('*').eq('status','activo').limit(600)),
    loadTable(sb.from('calendar_connections').select('*, professionals(full_name)').order('created_at'))
  ]);
  [state.patients,state.contacts,state.professionals,state.programs,state.appointmentTypes,state.rooms,
    state.appointments,state.availability,state.blocks,state.clinical,state.documents,state.documentTypes,
    state.requirements,state.submissions,state.profiles,state.charges,state.payments,state.audit,
    state.groups,state.groupEnrollments,state.patientPrograms,state.calendarConnections] = queries;
}

function allowedTabs() {
  const role = profile?.role_code;
  const blocked = {
    auditor:['clinical','documents','finance','access','communications'],
    finance:['clinical','documents','programs','access','communications','professionals','groups'],
    admission:['clinical','finance','audit'],
    communications:['clinical','documents','finance','access','audit','programs','groups'],
    professional:['access','finance','audit','communications'],
    medical:['access','finance','audit','communications'],
    psychologist:['access','finance','audit','communications'],
    social_worker:['access','finance','audit','communications'],
    therapeutic_operator:['access','finance','audit','communications']
  };
  const hidden = blocked[role] || [];
  const list = tabs.filter(tab => !hidden.includes(tab[0]));
  if (!list.some(tab => tab[0] === activeTab)) activeTab = list[0]?.[0] || 'dashboard';
  return list;
}

function render() {
  if (!session) { app.innerHTML = login(); bindLogin(); return; }
  if (!profile) {
    app.innerHTML = `<main class="login-wrap"><section class="login-card"><h1>Acceso pendiente</h1><p>Esta cuenta no tiene un perfil interno activo. Solicite una invitación al administrador.</p><button class="btn secondary" data-logout>Salir</button></section></main>`;
    document.querySelector('[data-logout]')?.addEventListener('click',() => sb.auth.signOut());
    return;
  }
  if (profile.account_kind !== 'internal') { window.location.href = '/portal/'; return; }
  app.innerHTML = shell(tabContent());
  bindBase(); bindTab(); maybeShowWelcome();
}

function login() {
  const demo = config.demoEnabled ? `<div class="demo-box"><p>Entrá con un clic, sin escribir nada:</p><div class="demo-grid"><button type="button" data-demo-login="direccion@senderos.demo"><strong>Dirección</strong><span>Vista completa del sistema</span></button><button type="button" data-demo-login="profesional@senderos.demo"><strong>Profesional</strong><span>Agenda, grupos, pacientes y clínica</span></button><button type="button" data-demo-login="auditoria@senderos.demo"><strong>Auditoría</strong><span>Trazabilidad, sin acceso clínico</span></button></div><p>La cuenta de paciente se usa desde el portal.</p></div>` : '';
  return `<main class="login-wrap"><section class="login-card"><img src="../assets/logo-senderos.png" alt=""><h1>Sistema interno</h1><p>Acceso seguro para equipos clínicos, administrativos y de dirección.</p><form id="loginForm" class="form"><label class="field">Email<input name="email" type="email" required autocomplete="email"></label><label class="field">Contraseña<input name="password" type="password" required autocomplete="current-password"></label><button class="btn primary">Ingresar</button></form>${demo}<a class="back-link" href="/">Volver a la web</a></section></main>`;
}
function shell(content) {
  const reset = isAdminRole() && config.demoEnabled ? `<button class="btn danger" data-demo-reset>Restaurar demo</button>` : '';
  const nav = allowedTabs().map(([id,label]) => `<button data-tab="${id}" class="${activeTab===id?'active':''}">${navIcon(id)}<span>${label}</span></button>`).join('');
  return `<div class="layout"><aside class="sidebar"><div class="brand"><img src="../assets/logo-senderos.png" alt=""><div><strong>Senderos de Libertad</strong><small>${esc(roleName(profile.role_code))}</small></div></div><nav class="nav">${nav}</nav><div class="side-foot"><button class="side-help" data-manual-open>${navIcon('manual')}<span>Manual de uso</span></button><button class="side-help" data-help-open>${navIcon('audit')}<span>Guía rápida</span></button><button class="logout" data-logout>Cerrar sesión</button></div></aside><main class="main"><header class="topbar"><div><p class="eyebrow">Operación clínica y administrativa</p><h1>${(tabs.find(tab => tab[0]===activeTab)||[])[1] || 'Sistema'}</h1></div><div class="top-actions"><button class="btn secondary" data-help-open>Guía</button>${reset}<button class="btn secondary" data-refresh>Actualizar</button></div></header><div id="messages"></div>${content}</main>${helpPanelHtml()}<div id="modalHost"></div><div id="manualHost"></div></div>`;
}
function notice(text,type='ok') { const element=document.getElementById('messages'); if(element){ element.innerHTML=`<div class="notice ${type==='error'?'error':'ok'}">${esc(text)}</div>`; element.scrollIntoView({behavior:'smooth',block:'nearest'}); } }

function tabContent() {
  return ({
    dashboard: dashboard(), patients: patientsTab(), professionals: professionalsTab(), schedule: scheduleTab(),
    groups: groupsTab(), clinical: clinicalTab(), documents: documentsTab(), programs: programsTab(),
    access: accessTab(), finance: financeTab(), communications: communicationsTab(), audit: auditTab()
  })[activeTab] || '';
}
function dashboard() {
  const active = state.patients.filter(patient => !['egresado','derivado','suspendido'].includes(patient.admission_status)).length;
  const upcoming = state.appointments.filter(item => new Date(item.start_at)>new Date() && !['cancelado','reprogramado'].includes(item.status)).length;
  const upcomingGroups = state.groups.filter(item => item.status==='programado' && new Date(item.start_at)>new Date()).length;
  const pendingDocs = state.requirements.filter(item => ['requested','rejected'].includes(item.status)).length;
  const pendingPayments = state.charges.filter(item => ['open','partial','overdue'].includes(item.status)).length;
  const requested = state.appointments.filter(item=>item.status==='solicitado').length;
  const requestedNote = requested ? `<p class="notice warn-inline">Hay <strong>${requested}</strong> turno(s) solicitados desde el portal esperando confirmación en Agenda.</p>` : '';
  return `<div class="stack"><div class="kpis"><div class="kpi b1"><span>Pacientes activos</span><strong>${active}</strong></div><div class="kpi"><span>Turnos próximos</span><strong>${upcoming}</strong></div><div class="kpi b4"><span>Grupos y talleres</span><strong>${upcomingGroups}</strong></div><div class="kpi b2"><span>Documentos solicitados</span><strong>${pendingDocs}</strong></div><div class="kpi b3"><span>Cargos abiertos</span><strong>${pendingPayments}</strong></div></div>${requestedNote}<div class="cols-2"><section class="panel"><h2>Próximos turnos</h2>${table(['Fecha','Paciente','Profesional','Estado'],state.appointments.filter(item=>new Date(item.start_at)>new Date()).slice(0,8).map(item=>[dateTime(item.start_at),esc(name(item.patients)),esc(item.professionals?.full_name||'-'),tag(item.status)]))}</section><section class="panel"><h2>Próximos grupos y talleres</h2>${table(['Fecha','Espacio','Profesional','Cupo'],state.groups.filter(item=>item.status==='programado'&&new Date(item.start_at)>new Date()).slice(0,8).map(item=>[dateTime(item.start_at),esc(item.title),esc(item.professionals?.full_name||'-'),`${groupCount(item.id)}/${item.capacity}`]))}</section></div></div>`;
}
function groupCount(sessionId){ return state.groupEnrollments.filter(item=>item.session_id===sessionId && ['inscripto','asistio'].includes(item.status)).length; }

function patientsTab() {
  const rows = state.patients.map(patient => [esc(name(patient)),esc(patient.document_number||'-'),tag(patient.admission_status),tag(patient.risk_level,patient.risk_level==='alto'?'red':''),esc(patient.phone||'-')]);
  const form = `<section class="panel"><h2>Alta de paciente y referente</h2><form id="patientForm" class="form two-cols">${field('first_name','Nombre','text',true)}${field('last_name','Apellido','text',true)}${field('document_number','DNI','text')}${field('birth_date','Nacimiento','date')}${field('phone','Teléfono')}${field('email','Email','email')}<label class="field">Estado<select name="admission_status"><option value="preingreso">Preingreso</option><option value="evaluacion">Evaluación</option><option value="admitido">Admitido</option><option value="en_tratamiento">En tratamiento</option><option value="seguimiento">Seguimiento</option></select></label><label class="field">Riesgo<select name="risk_level"><option value="bajo">Bajo</option><option value="medio">Medio</option><option value="alto">Alto</option></select></label><label class="field full">Programa<select name="program_id"><option value="">Sin asignar</option>${selectOptions(state.programs,item=>item.name)}</select></label><label class="field full">Profesional responsable<select name="professional_id"><option value="">Sin asignar</option>${selectOptions(state.professionals,item=>item.full_name)}</select></label><h3 class="field full">Familiar o referente</h3>${field('contact_name','Nombre')}${field('contact_email','Email','email')}${field('contact_phone','Teléfono')}<label class="field">Relación<input name="contact_relationship" placeholder="Madre, tutor, referente"></label><label class="field inline full"><input type="checkbox" name="contact_authorized"> Autorizar portal y comunicaciones para este contacto</label><button class="btn primary full">Guardar paciente</button></form></section>`;
  return `<div class="board"><div class="board-main"><section class="panel"><h2>Personas acompañadas <span class="pill">${state.patients.length}</span></h2>${table(['Paciente','DNI','Estado','Riesgo','Teléfono'],rows)}</section></div><aside class="board-side">${form}</aside></div>`;
}
function professionalsTab() {
  const rows = state.professionals.map(item => [esc(item.full_name),esc(item.role_title),esc(item.specialty||'-'),esc(item.email||'-')]);
  const form = isAdmin() ? `<section class="panel"><h2>Alta de profesional</h2><form id="professionalForm" class="form two-cols">${field('full_name','Nombre completo','text',true)}${field('role_title','Cargo','text',true)}${field('specialty','Especialidad')}${field('license_number','Matrícula')}${field('email','Email','email')}${field('phone','Teléfono')}<label class="field full">Perfil<textarea name="bio" rows="3"></textarea></label><button class="btn primary full">Guardar profesional</button></form><p class="panel-note">Después del alta: creá su cuenta en <strong>Accesos</strong> y cargá su <strong>disponibilidad</strong> en Agenda para poder asignarle turnos.</p></section>` : `<section class="panel"><h2>Alta de profesional</h2><p class="muted">El alta y la edición del equipo la realizan Dirección o Coordinación clínica. Si falta un profesional, pedile el alta a tu coordinación.</p></section>`;
  const main=`<section class="panel"><h2>Equipo profesional <span class="pill">${state.professionals.length}</span></h2>${table(['Nombre','Cargo','Especialidad','Email'],rows)}</section>`;
  return `<div class="board"><div class="board-main">${main}</div><aside class="board-side">${form}</aside></div>`;
}

function weekCalendar() {
  const first = new Date(); first.setHours(0,0,0,0);
  const days = Array.from({length:7},(_,index)=>new Date(first.getTime()+index*86400000));
  return `<div class="week-grid">${days.map(day=>{
    const key=localDateKey(day);
    const entries=state.appointments.filter(item=>localDateKey(item.start_at)===key && !['cancelado','reprogramado'].includes(item.status));
    const groups=state.groups.filter(item=>item.status==='programado' && localDateKey(item.start_at)===key);
    const cells=[
      ...entries.map(item=>`<div class="cal-item"><small>${timeShort(item.start_at)}</small><strong>${esc(name(item.patients))}</strong><small>${esc(item.professionals?.full_name||'-')}</small></div>`),
      ...groups.map(item=>`<div class="cal-item group"><small>${timeShort(item.start_at)}</small><strong>${esc(item.title)}</strong><small>${item.session_type==='taller'?'Taller':'Terapia grupal'} · ${groupCount(item.id)}/${item.capacity}</small></div>`)
    ].join('');
    return `<section class="panel cal-day"><strong class="cal-head">${day.toLocaleDateString('es-AR',{weekday:'short',day:'numeric'})}</strong>${cells || '<p class="muted cal-empty">Sin actividad</p>'}</section>`;
  }).join('')}</div>`;
}

function scheduleTab() {
  const appointmentRows = state.appointments.map(item => [dateTime(item.start_at),esc(name(item.patients)),esc(item.professionals?.full_name||'-'),esc(item.rooms?.name||'-'),tag(item.status,item.status==='solicitado'?'amber':''),`<div class="row-actions">${['confirmado','asistido','ausente','cancelado','reprogramado'].map(status=>`<button class="btn small secondary" data-appointment-status="${status}" data-id="${item.id}">${status}</button>`).join('')}</div>`]);
  const create = `<section class="panel"><h2>Agendar turno</h2><p class="panel-note">Elegí profesional, tipo y día: se muestran solo los horarios libres (descuenta turnos, bloqueos y grupos).</p><form id="appointmentForm" class="form two-cols"><label class="field full">Paciente<select name="patient_id" required>${selectOptions(scopedPatients(),name)}</select></label><label class="field full">Profesional<select name="professional_id" id="slotProfessional" required>${selectOptions(state.professionals,item=>item.full_name)}</select></label><label class="field">Tipo<select name="appointment_type_id" id="slotType" required>${state.appointmentTypes.map(item=>`<option value="${item.id}" data-minutes="${item.default_minutes||50}">${esc(item.name)}</option>`).join('')}</select></label><label class="field">Día<input type="date" id="slotDate" required min="${localDateKey(new Date())}"></label><div class="field full"><span>Horarios disponibles</span><div id="slotGrid" class="slot-grid"><p class="muted">Elegí profesional y día para ver los horarios.</p></div></div><label class="field">Sala<select name="room_id"><option value="">Sin sala</option>${selectOptions(state.rooms,item=>item.name)}</select></label><label class="field">Programa<select name="program_id"><option value="">Sin programa</option>${selectOptions(state.programs,item=>item.name)}</select></label><label class="field">Modalidad<select name="modality"><option value="presencial">Presencial</option><option value="online">Online</option></select></label><label class="field">Motivo<input name="reason"></label><input type="hidden" name="start_at" id="slotStart"><input type="hidden" name="end_at" id="slotEnd"><button class="btn primary full" id="slotSubmit" disabled>Elegí un horario</button></form></section>`;
  const availability = `<section class="panel"><h2>Disponibilidad profesional</h2><form id="availabilityForm" class="form two-cols"><label class="field full">Profesional<select name="professional_id" required>${selectOptions(state.professionals,item=>item.full_name)}</select></label><label class="field">Día<select name="weekday"><option value="1">Lunes</option><option value="2">Martes</option><option value="3">Miércoles</option><option value="4">Jueves</option><option value="5">Viernes</option><option value="6">Sábado</option><option value="0">Domingo</option></select></label>${field('start_time','Desde','time',true)}${field('end_time','Hasta','time',true)}${field('effective_from','Vigente desde','date',true)}<button class="btn secondary full">Agregar disponibilidad</button></form><div class="list">${state.availability.map(item=>`<div class="item"><strong>${esc(item.professionals?.full_name||'-')}</strong><span>${['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][item.weekday]} · ${item.start_time.slice(0,5)}–${item.end_time.slice(0,5)}</span></div>`).join('') || '<p class="muted">Sin disponibilidad cargada. Sin este paso no se pueden ofrecer turnos.</p>'}</div></section>`;
  const block = `<section class="panel"><h2>Bloquear horario</h2><form id="blockForm" class="form two-cols"><label class="field full">Profesional<select name="professional_id"><option value="">Solo sala</option>${selectOptions(state.professionals,item=>item.full_name)}</select></label><label class="field full">Sala<select name="room_id"><option value="">Sin sala</option>${selectOptions(state.rooms,item=>item.name)}</select></label>${field('title','Motivo','text',true)}<label class="field">Tipo<select name="block_type"><option value="manual">Bloqueo manual</option><option value="leave">Licencia</option><option value="meeting">Reunión</option><option value="external_busy">Ocupado externo</option></select></label>${field('start_at','Inicio','datetime-local',true)}${field('end_at','Fin','datetime-local',true)}<button class="btn danger full">Bloquear</button></form></section>`;
  const gcal = isAdminRole() ? `<section class="panel"><h2>Google Calendar</h2><p class="panel-note">Cada turno o grupo se publica como “Reservado”, sin datos clínicos. La sincronización corre cada 15 minutos.</p><div class="list">${state.professionals.map(prof=>{const conn=state.calendarConnections.find(item=>item.professional_id===prof.id);const status=conn?tag(conn.status==='connected'?'conectado':conn.status,conn?.status==='connected'?'green':'amber'):tag('sin conectar');return `<div class="item"><strong>${esc(prof.full_name)}</strong><span class="row-actions">${status}<button class="btn small secondary" data-gcal-connect="${prof.id}">${conn?.status==='connected'?'Reconectar':'Conectar'}</button></span></div>`;}).join('')}</div></section>` : '';
  return `<div class="board"><div class="board-main"><section class="panel"><h2>Calendario semanal</h2>${weekCalendar()}</section><section class="panel"><h2>Turnos y estados</h2><p class="panel-note">Los turnos en estado <strong>solicitado</strong> llegaron desde el portal: confirmalos o reprogramalos.</p>${table(['Fecha','Paciente','Profesional','Sala','Estado','Acción'],appointmentRows)}</section><section class="panel"><h2>Bloqueos próximos</h2>${table(['Desde','Hasta','Profesional','Motivo'],state.blocks.map(item=>[dateTime(item.start_at),dateTime(item.end_at),esc(item.professionals?.full_name||item.rooms?.name||'-'),esc(item.title)]))}</section></div><aside class="board-side">${create}${availability}${block}${gcal}</aside></div>`;
}

function groupsTab() {
  const upcoming = state.groups.filter(item=>item.status!=='cancelado');
  const rows = upcoming.map(item=>{
    const enrolled = groupCount(item.id); const full = enrolled>=item.capacity;
    return [dateTime(item.start_at),`<button class="link-btn" data-group-open="${item.id}">${esc(item.title)}</button>`,tag(item.session_type==='taller'?'taller':'terapia grupal',item.session_type==='taller'?'amber':'green'),esc(item.professionals?.full_name||'-'),`<span class="${full?'cap-full':''}">${enrolled}/${item.capacity}</span>`,tag(item.open_enrollment?'portal abierto':'solo equipo'),tag(item.status)];
  });
  const detail = groupDetail();
  const form = canSchedule() ? `<section class="panel"><h2>Publicar taller o grupo</h2><form id="groupForm" class="form two-cols"><label class="field">Tipo<select name="session_type"><option value="taller">Taller</option><option value="terapia_grupal">Terapia grupal</option></select></label>${field('title','Título','text',true)}<label class="field full">Descripción<textarea name="description" rows="3" placeholder="Se muestra en el portal si el espacio está abierto."></textarea></label><label class="field full">Profesional a cargo<select name="professional_id" required>${selectOptions(state.professionals,item=>item.full_name)}</select></label><label class="field">Programa<select name="program_id"><option value="">Sin programa</option>${selectOptions(state.programs,item=>item.name)}</select></label><label class="field">Sala<select name="room_id"><option value="">Sin sala</option>${selectOptions(state.rooms,item=>item.name)}</select></label>${field('capacity','Cupo','number',true,'min="1" max="200" value="12"')}<label class="field">Modalidad<select name="modality"><option value="presencial">Presencial</option><option value="online">Online</option></select></label>${field('date','Día','date',true,`min="${localDateKey(new Date())}"`)}${field('start_time','Desde','time',true)}${field('end_time','Hasta','time',true)}<label class="field inline full"><input type="checkbox" name="open_enrollment" checked> Abierto en el portal (las personas pueden inscribirse solas)</label><button class="btn primary full">Publicar espacio</button></form></section>` : '';
  return `<div class="board"><div class="board-main"><section class="panel"><h2>Talleres y terapia grupal <span class="pill">${upcoming.length}</span></h2><p class="panel-note">Tocá el nombre de un espacio para ver inscriptos, sumar participantes y marcar asistencia.</p>${table(['Fecha','Espacio','Tipo','Profesional','Cupo','Inscripción','Estado'],rows)}</section>${detail}</div><aside class="board-side">${form}</aside></div>`;
}
function groupDetail(){
  if (!selectedGroupId) return '';
  const group = state.groups.find(item=>item.id===selectedGroupId);
  if (!group) { selectedGroupId=null; return ''; }
  const enrollments = state.groupEnrollments.filter(item=>item.session_id===group.id && item.status!=='cancelado');
  const enrolledIds = new Set(enrollments.map(item=>item.patient_id));
  const candidates = scopedPatients().filter(item=>!enrolledIds.has(item.id));
  const rows = enrollments.map(item=>[esc(name(item.patients)),tag(item.status,item.status==='asistio'?'green':item.status==='ausente'?'red':''),esc(item.enrolled_via==='portal'?'Portal':'Equipo'),`<div class="row-actions"><button class="btn small secondary" data-attendance="asistio" data-id="${item.id}">Asistió</button><button class="btn small secondary" data-attendance="ausente" data-id="${item.id}">Ausente</button><button class="btn small danger" data-unenroll="${item.id}">Quitar</button></div>`]);
  const actions = canSchedule() ? `<div class="row-actions" style="margin-top:10px"><button class="btn small secondary" data-group-status="realizado" data-id="${group.id}">Marcar realizada</button><button class="btn small danger" data-group-status="cancelado" data-id="${group.id}">Cancelar sesión</button></div>` : '';
  const enrollForm = canSchedule() ? `<form id="enrollForm" class="form inline-form" data-session="${group.id}"><select name="patient_id" required>${selectOptions(candidates,name)}</select><button class="btn secondary">Inscribir</button></form>` : '';
  return `<section class="panel highlight"><h2>${esc(group.title)} <span class="pill">${groupCount(group.id)}/${group.capacity}</span></h2><p class="muted">${esc(group.description||'')}</p><p class="muted">${dateTime(group.start_at)} a ${timeShort(group.end_at)} · ${esc(group.professionals?.full_name||'-')} · ${esc(group.rooms?.name||'Sin sala')} · ${group.open_enrollment?'Inscripción abierta en el portal':'Inscripción por el equipo'}</p>${actions}<h3 style="margin:14px 0 6px">Participantes</h3>${table(['Paciente','Estado','Vía','Acción'],rows)}${enrollForm}</section>`;
}

function clinicalTab() {
  const form = `<section class="panel"><h2>Nueva evolución</h2><form id="clinicalForm" class="form two-cols"><label class="field full">Paciente<select name="patient_id" required>${selectOptions(scopedPatients(),name)}</select></label><label class="field full">Profesional<select name="professional_id"><option value="">Mi profesional asociado</option>${selectOptions(state.professionals,item=>item.full_name)}</select></label><label class="field">Tipo<input name="entry_type" value="evolucion"></label><label class="field">Estado<select name="status"><option value="draft">Borrador</option><option value="signed">Firmar y cerrar</option></select></label>${field('title','Título','text',true)}<label class="field full">Contenido<textarea name="body" rows="9" required></textarea></label><button class="btn primary full">Guardar</button></form></section>`;
  return `<div class="board"><div class="board-main"><section class="panel"><h2>Registros clínicos recientes</h2><p class="panel-note">Los registros firmados no se editan: quedan protegidos y se corrigen mediante una rectificación.</p>${table(['Fecha','Paciente','Título','Estado'],state.clinical.map(item=>[dateTime(item.created_at),esc(name(item.patients)),esc(item.title),tag(item.status)]))}</section></div><aside class="board-side">${form}</aside></div>`;
}
function documentsTab() {
  const scopeNote = isClinicalRole() ? '<p class="panel-note">Solo aparecen tus pacientes asignados o con turnos con vos: el sistema protege la confidencialidad del resto.</p>' : '';
  const upload = canManageDocuments() ? `<section class="panel"><h2>Cargar documento interno</h2>${scopeNote}<form id="documentForm" class="form two-cols"><label class="field full">Paciente<select name="patient_id" required>${selectOptions(scopedPatients(),name)}</select></label><label class="field full">Tipo<select name="document_type_id"><option value="">Sin tipo</option>${selectOptions(state.documentTypes,item=>item.name)}</select></label>${field('title','Título','text',true)}<label class="field">Visibilidad<select name="visibility"><option value="private_administrative">Administrativo</option><option value="private_clinical">Clínico</option><option value="internal_direction">Dirección</option></select></label><label class="field full">Archivo (PDF o imagen, hasta 10 MB)<input name="file" type="file" accept=".pdf,image/png,image/jpeg,image/webp"></label><button class="btn primary full">Guardar documento</button></form></section>` : '';
  const request = canManageDocuments() ? `<section class="panel"><h2>Solicitar documentación</h2><form id="requirementForm" class="form two-cols"><label class="field full">Paciente<select name="patient_id" required>${selectOptions(scopedPatients(),name)}</select></label><label class="field full">Tipo<select name="document_type_id"><option value="">Otro</option>${selectOptions(state.documentTypes,item=>item.name)}</select></label>${field('title','Documento requerido','text',true)}${field('due_date','Vencimiento','date')}<label class="field full">Indicaciones<textarea name="instructions" rows="3"></textarea></label><label class="field inline"><input type="checkbox" name="allow_patient" checked> Puede subir paciente</label><label class="field inline"><input type="checkbox" name="allow_family" checked> Puede subir familiar</label><button class="btn secondary full">Solicitar en portal</button></form></section>` : '';
  const docs = state.documents.map(item=>[esc(name(item.patients)),esc(item.title),esc(item.document_types?.name||'-'),tag(item.status),`<button class="btn small secondary" data-release-doc="${item.id}" data-patient="${item.patient_id}">Liberar al paciente</button>`]);
  const requirements = state.requirements.map(item=>[esc(name(item.patients)),esc(item.title),item.due_date||'-',tag(item.status)]);
  const submissions = state.submissions.map(item=>[esc(name(item.patients)),esc(item.document_requirements?.title||'-'),dateTime(item.created_at),tag(item.status),item.status==='submitted'?`<div class="row-actions"><button class="btn small primary" data-review="approved" data-id="${item.id}">Aprobar</button><button class="btn small danger" data-review="rejected" data-id="${item.id}">Rechazar</button></div>`:'-']);
  const main=`<section class="panel"><h2>Documentos del legajo</h2>${table(['Paciente','Documento','Tipo','Estado','Portal'],docs)}</section><section class="panel"><h2>Solicitudes pendientes</h2>${table(['Paciente','Documento','Vence','Estado'],requirements)}</section><section class="panel"><h2>Archivos recibidos desde el portal</h2>${table(['Paciente','Solicitud','Recibido','Estado','Acción'],submissions)}</section>`;
  const side=[upload,request].filter(Boolean).join('');
  return side?`<div class="board"><div class="board-main">${main}</div><aside class="board-side">${side}</aside></div>`:`<div class="board wide">${main}</div>`;
}
function programsTab() {
  const form = isAdmin() ? `<section class="panel"><h2>Nuevo programa</h2><form id="programForm" class="form"><label class="field">Nombre<input name="name" required></label>${field('duration_weeks','Duración (semanas)','number')}<label class="field">Descripción<textarea name="description" rows="4"></textarea></label><button class="btn primary">Guardar programa</button></form></section>`:'';
  const main=`<section class="panel"><h2>Dispositivos y programas <span class="pill">${state.programs.length}</span></h2>${table(['Programa','Duración','Descripción'],state.programs.map(item=>[esc(item.name),item.duration_weeks||'-',esc(item.description||'-')]))}</section>`;
  return form?`<div class="board"><div class="board-main">${main}</div><aside class="board-side">${form}</aside></div>`:`<div class="board wide">${main}</div>`;
}
function accessTab() {
  if (!isAdmin()) return '<section class="panel"><p class="muted">No posee permisos para gestionar accesos.</p></section>';
  const users = state.profiles.map(item=>[esc(item.full_name),esc(item.email),esc(roleName(item.role_code)),tag(item.active?'activo':'inactivo',item.active?'green':'red'),`<div class="row-actions"><button class="btn small secondary" data-toggle-user="${item.id}" data-active="${item.active?'false':'true'}">${item.active?'Desactivar':'Activar'}</button><button class="btn small secondary" data-reset-user="${item.id}">Restablecer</button></div>`]);
  return `<div class="board"><div class="board-main"><section class="panel"><h2>Usuarios y credenciales <span class="pill">${state.profiles.length}</span></h2>${table(['Nombre','Email','Rol','Estado','Acción'],users)}</section></div><aside class="board-side"><section class="panel"><h2>Crear acceso seguro</h2><p class="panel-note">Paciente y familiar son cuentas de portal; el familiar requiere un contacto autorizado. Nunca puede recibir un rol de auditoría.</p><form id="accessForm" class="form two-cols"><label class="field">Tipo<select name="kind" id="accessKind"><option value="patient">Paciente</option><option value="family">Familiar autorizado</option><option value="professional">Profesional clínico</option><option value="internal">Administración interna</option></select></label><div class="field" id="accessRoleWrap"></div><div class="field full" id="accessLinkWrap"></div>${field('full_name','Nombre visible','text',true)}${field('email','Email','email',true)}${field('password','Contraseña temporal','password',true)}<small class="field full">Mínimo 12 caracteres, con mayúscula, minúscula y número. El acceso se crea nuevo: no se reasignan cuentas existentes.</small><button class="btn primary full">Crear acceso</button></form></section></aside></div>`;
}
function financeTab() {
  if (!canFinance()) return '<section class="panel"><p class="muted">No posee permisos de finanzas.</p></section>';
  const chargeRows = state.charges.map(item=>[esc(name(item.patients)),esc(item.description),money(item.amount,item.currency),money(item.paid_amount,item.currency),tag(item.status),`<button class="btn small secondary" data-pay-charge="${item.id}" data-patient="${item.patient_id||''}">Registrar pago</button>`]);
  return `<div class="board"><div class="board-main"><section class="panel"><h2>Cargos y saldos</h2>${table(['Paciente','Concepto','Cargo','Pagado','Estado','Acción'],chargeRows)}</section><section class="panel"><h2>Últimos pagos</h2>${table(['Fecha','Paciente','Monto','Método','Estado'],state.payments.map(item=>[dateTime(item.paid_at),esc(name(item.patients)),money(item.amount,item.currency),esc(item.method),tag(item.status)]))}</section></div><aside class="board-side"><section class="panel"><h2>Crear cargo</h2><form id="chargeForm" class="form two-cols"><label class="field full">Paciente<select name="patient_id"><option value="">Sin paciente (donación/convenio)</option>${selectOptions(state.patients,name)}</select></label>${field('category','Categoría','text',true)}${field('amount','Monto','number',true)}${field('description','Descripción','text',true)}${field('due_date','Vencimiento','date')}<label class="field">Moneda<select name="currency"><option>ARS</option><option>USD</option></select></label><button class="btn primary full">Registrar cargo</button></form></section><section class="panel"><h2>Registrar pago manual</h2><form id="paymentForm" class="form two-cols"><input type="hidden" name="charge_id"><label class="field full">Paciente<select name="patient_id"><option value="">Sin paciente</option>${selectOptions(state.patients,name)}</select></label>${field('amount','Monto','number',true)}<label class="field">Método<select name="method"><option value="bank_transfer">Transferencia</option><option value="cash">Efectivo</option><option value="pos">POS</option><option value="agreement">Convenio</option><option value="scholarship">Beca</option><option value="other">Otro</option></select></label>${field('reference','Referencia / comprobante')}${field('payer_name','Pagador')}<label class="field full">Notas<input name="notes"></label><button class="btn secondary full">Confirmar pago</button></form></section></aside></div>`;
}
function communicationsTab() {
  if (!canCommunicate()) return '<section class="panel"><p class="muted">No posee permisos para enviar comunicados.</p></section>';
  return `<div class="board wide" style="max-width:820px"><section class="panel"><h2>Nuevo comunicado institucional</h2><p class="muted">No incluir información clínica sensible. Los correos quedan en cola hasta configurar un proveedor de envío.</p><form id="communicationForm" class="form two-cols"><label class="field">Audiencia<select name="audience"><option value="professionals">Profesionales</option><option value="patients">Pacientes</option><option value="families">Familiares autorizados</option><option value="patient_network">Paciente y familia</option></select></label><label class="field">Canal<select name="channel"><option value="in_app">Portal / sistema</option><option value="email">Email (cola preparada)</option></select></label><label class="field full">Paciente específico (opcional; obligatorio para red)<select name="patient_id"><option value="">Toda la audiencia</option>${selectOptions(state.patients,name)}</select></label>${field('title','Asunto','text',true)}<label class="field full">Mensaje<textarea name="body" rows="8" required></textarea></label><button class="btn primary full">Enviar comunicado</button></form></section></div>`;
}
function auditTab() {
  return `<div class="board wide"><section class="panel"><h2>Trazabilidad de la operación</h2><p class="panel-note">Cada acción queda registrada con su responsable, rol y nivel de riesgo. Auditoría no accede a la historia clínica.</p>${table(['Fecha','Acción','Entidad','Rol','Riesgo'],state.audit.map(item=>[dateTime(item.created_at),esc(item.action),esc(item.entity_table||'-'),esc(item.actor_role||'-'),tag(item.risk_level)]))}</section></div>`;
}

function bindLogin() {
  document.getElementById('loginForm')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const {error}=await sb.auth.signInWithPassword({email:data.get('email'),password:data.get('password')});if(error){app.innerHTML=login();bindLogin();alert('No se pudo iniciar sesión. Revisá el email y la contraseña.');}});
  document.querySelectorAll('[data-demo-login]').forEach(button=>button.addEventListener('click',async()=>{
    const email=button.dataset.demoLogin;const prev=button.innerHTML;button.disabled=true;button.innerHTML='<strong>Ingresando…</strong>';
    try{
      const response=await fetch('/api/init-demo-users',{method:'POST'});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'No se pudo preparar la demo.');}
      const {error}=await sb.auth.signInWithPassword({email,password:'Senderos2026!'});
      if(error)throw error;
    }catch(error){alert(error.message||'No se pudo ingresar.');button.disabled=false;button.innerHTML=prev;}
  }));
}
function bindBase() {
  document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{activeTab=button.dataset.tab;render();}));
  document.querySelector('[data-logout]')?.addEventListener('click',()=>sb.auth.signOut());
  document.querySelector('[data-refresh]')?.addEventListener('click',async()=>{await load();render();notice('Información actualizada.');});
  document.querySelectorAll('[data-help-open]').forEach(button=>button.addEventListener('click',openHelp));
  document.querySelector('[data-help-close]')?.addEventListener('click',closeHelp);
  document.querySelector('[data-help-overlay]')?.addEventListener('click',closeHelp);
  document.querySelectorAll('[data-manual-open]').forEach(button=>button.addEventListener('click',()=>{closeHelp();openManual();}));
  document.querySelectorAll('[data-demo-reset]').forEach(button=>button.addEventListener('click',resetDemo));
}
async function save(tableName,payload,message) {
  const { error } = await sb.from(tableName).insert(payload);
  if (error) throw error;
  await load(); render(); notice(message);
}

// ---- Agenda con slots ----------------------------------------------------
async function refreshSlots() {
  const grid=document.getElementById('slotGrid'); if(!grid) return;
  const professional=document.getElementById('slotProfessional')?.value;
  const date=document.getElementById('slotDate')?.value;
  const typeOption=document.getElementById('slotType')?.selectedOptions?.[0];
  const minutes=Number(typeOption?.dataset?.minutes||50);
  const submit=document.getElementById('slotSubmit');
  document.getElementById('slotStart').value=''; document.getElementById('slotEnd').value='';
  if(submit){submit.disabled=true;submit.textContent='Elegí un horario';}
  if(!professional||!date){grid.innerHTML='<p class="muted">Elegí profesional y día para ver los horarios.</p>';return;}
  grid.innerHTML='<p class="muted">Buscando horarios libres…</p>';
  const {data,error}=await sb.rpc('get_available_slots',{p_professional_id:professional,p_date:date,p_duration_minutes:minutes});
  if(error){grid.innerHTML=`<p class="muted">${esc(friendly(error))}</p>`;return;}
  if(!data?.length){grid.innerHTML='<p class="muted">Sin horarios libres ese día. Probá otro día o revisá la disponibilidad del profesional.</p>';return;}
  grid.innerHTML=data.map(slot=>`<button type="button" class="slot" data-slot-start="${slot.slot_start}" data-slot-end="${slot.slot_end}">${timeShort(slot.slot_start)}</button>`).join('');
  grid.querySelectorAll('.slot').forEach(button=>button.addEventListener('click',()=>{
    grid.querySelectorAll('.slot').forEach(item=>item.classList.remove('picked'));
    button.classList.add('picked');
    document.getElementById('slotStart').value=button.dataset.slotStart;
    document.getElementById('slotEnd').value=button.dataset.slotEnd;
    if(submit){submit.disabled=false;submit.textContent=`Confirmar turno · ${timeShort(button.dataset.slotStart)}`;}
  }));
}

function bindTab() {
  document.getElementById('patientForm')?.addEventListener('submit',async event=>{
    event.preventDefault(); const form=event.currentTarget; const payload=pick(form,['first_name','last_name','document_number','birth_date','phone','email','admission_status','risk_level']); payload.admission_date=new Date().toISOString().slice(0,10);
    const {data,error}=await sb.from('patients').insert(payload).select().single(); if(error) return notice(friendly(error),'error');
    const formData=new FormData(form); const programId=formData.get('program_id'); const professionalId=formData.get('professional_id');
    if(programId) await sb.from('patient_programs').insert({patient_id:data.id,program_id:programId,responsible_professional_id:professionalId||null,current_stage:'Primer contacto',goals:'Acompañamiento inicial.'});
    if(formData.get('contact_name')) await sb.from('patient_contacts').insert({patient_id:data.id,full_name:formData.get('contact_name'),email:formData.get('contact_email')||null,phone:formData.get('contact_phone')||null,relationship:formData.get('contact_relationship')||null,is_authorized:Boolean(formData.get('contact_authorized')),can_access_portal:Boolean(formData.get('contact_authorized')),can_receive_updates:Boolean(formData.get('contact_authorized'))});
    await load();render();notice('Paciente y referente guardados.');
  });
  document.getElementById('professionalForm')?.addEventListener('submit',async event=>{event.preventDefault();try{await save('professionals',{...pick(event.currentTarget,['full_name','role_title','specialty','license_number','email','phone','bio']),active:true},'Profesional guardado. Recordá crearle acceso y cargar su disponibilidad.');}catch(error){notice(friendly(error),'error');}});

  ['slotProfessional','slotDate','slotType'].forEach(id=>document.getElementById(id)?.addEventListener('change',refreshSlots));
  document.getElementById('appointmentForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const data=pick(event.currentTarget,['patient_id','professional_id','appointment_type_id','start_at','end_at','program_id','room_id','modality','reason']);
    if(!data.start_at||!data.end_at) return notice('Elegí un horario disponible antes de confirmar.','error');
    const {error}=await sb.rpc('create_appointment_secure',{p_patient_id:data.patient_id,p_professional_id:data.professional_id,p_appointment_type_id:data.appointment_type_id,p_start_at:data.start_at,p_end_at:data.end_at,p_program_id:data.program_id||null,p_room_id:data.room_id||null,p_location_id:null,p_modality:data.modality,p_reason:data.reason||null});
    if(error)return notice(friendly(error),'error');
    await load();render();notice('Turno confirmado. Quedó protegido contra superposiciones y visible en el portal de la persona.');
  });
  document.getElementById('availabilityForm')?.addEventListener('submit',async event=>{event.preventDefault();try{await save('professional_availability_rules',{...pick(event.currentTarget,['professional_id','weekday','start_time','end_time','effective_from']),active:true},'Disponibilidad agregada: esos horarios ya se ofrecen al agendar.');}catch(error){notice(friendly(error),'error');}});
  document.getElementById('blockForm')?.addEventListener('submit',async event=>{event.preventDefault();const data=pick(event.currentTarget,['professional_id','room_id','title','block_type','start_at','end_at']);data.professional_id=data.professional_id||null;data.room_id=data.room_id||null;if(!data.professional_id&&!data.room_id)return notice('Seleccione profesional o sala.','error');try{await save('calendar_blocks',{...data,active:true},'Horario bloqueado: dejó de ofrecerse en la agenda.');}catch(error){notice(friendly(error),'error');}});
  document.querySelectorAll('[data-appointment-status]').forEach(button=>button.addEventListener('click',async()=>{const {error}=await sb.rpc('update_appointment_status_secure',{p_appointment_id:button.dataset.id,p_status:button.dataset.appointmentStatus,p_attendance_status:null,p_reason:null});if(error)return notice(friendly(error),'error');await load();render();notice('Estado actualizado.');}));

  // Grupos y talleres
  document.querySelectorAll('[data-group-open]').forEach(button=>button.addEventListener('click',()=>{selectedGroupId=button.dataset.groupOpen;render();}));
  document.getElementById('groupForm')?.addEventListener('submit',async event=>{
    event.preventDefault(); const fd=new FormData(event.currentTarget);
    const date=fd.get('date'); const startTime=fd.get('start_time'); const endTime=fd.get('end_time');
    if(!date||!startTime||!endTime) return notice('Completá día y horario.','error');
    if(endTime<=startTime) return notice('La hora de fin debe ser posterior a la de inicio.','error');
    const payload={session_type:fd.get('session_type'),title:fd.get('title'),description:fd.get('description')||null,professional_id:fd.get('professional_id'),program_id:fd.get('program_id')||null,room_id:fd.get('room_id')||null,capacity:Number(fd.get('capacity')||12),modality:fd.get('modality'),open_enrollment:Boolean(fd.get('open_enrollment')),start_at:new Date(`${date}T${startTime}`).toISOString(),end_at:new Date(`${date}T${endTime}`).toISOString(),status:'programado'};
    const {data,error}=await sb.from('group_sessions').insert(payload).select().single();
    if(error)return notice(friendly(error),'error');
    selectedGroupId=data.id; await load();render();notice(payload.open_enrollment?'Espacio publicado: ya aparece en el portal para inscribirse.':'Espacio creado. Inscribí a los participantes desde el detalle.');
  });
  document.getElementById('enrollForm')?.addEventListener('submit',async event=>{
    event.preventDefault(); const fd=new FormData(event.currentTarget);
    const {error}=await sb.rpc('enroll_group_session',{p_session_id:event.currentTarget.dataset.session,p_patient_id:fd.get('patient_id')});
    if(error)return notice(friendly(error),'error');
    await load();render();notice('Participante inscripto.');
  });
  document.querySelectorAll('[data-attendance]').forEach(button=>button.addEventListener('click',async()=>{const {error}=await sb.rpc('set_group_attendance',{p_enrollment_id:button.dataset.id,p_status:button.dataset.attendance});if(error)return notice(friendly(error),'error');await load();render();notice('Asistencia registrada.');}));
  document.querySelectorAll('[data-unenroll]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('¿Quitar a esta persona del espacio?'))return;const {error}=await sb.rpc('cancel_group_enrollment',{p_enrollment_id:button.dataset.unenroll});if(error)return notice(friendly(error),'error');await load();render();notice('Inscripción cancelada.');}));
  document.querySelectorAll('[data-group-status]').forEach(button=>button.addEventListener('click',async()=>{const status=button.dataset.groupStatus;if(status==='cancelado'&&!confirm('¿Cancelar esta sesión? El horario vuelve a quedar libre.'))return;const {error}=await sb.rpc('update_group_session_status',{p_session_id:button.dataset.id,p_status:status});if(error)return notice(friendly(error),'error');await load();render();notice(status==='cancelado'?'Sesión cancelada.':'Sesión marcada como realizada.');}));

  document.getElementById('clinicalForm')?.addEventListener('submit',async event=>{event.preventDefault();const data=pick(event.currentTarget,['patient_id','professional_id','entry_type','title','body','status']);data.professional_id=data.professional_id||null;if(data.status==='signed')data.signed_at=new Date().toISOString();try{await save('clinical_entries',data,'Registro clínico guardado.');}catch(error){notice(friendly(error),'error');}});
  document.getElementById('documentForm')?.addEventListener('submit',uploadInternalDocument);
  document.getElementById('requirementForm')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const data=pick(form,['patient_id','document_type_id','title','instructions','due_date']);const fd=new FormData(form);data.document_type_id=data.document_type_id||null;data.due_date=data.due_date||null;data.allow_patient=Boolean(fd.get('allow_patient'));data.allow_family=Boolean(fd.get('allow_family'));try{await save('document_requirements',data,'Solicitud publicada en el portal.');}catch(error){notice(friendly(error),'error');}});
  document.querySelectorAll('[data-review]').forEach(button=>button.addEventListener('click',async()=>{const note=prompt(button.dataset.review==='approved'?'Nota interna opcional:':'Motivo del rechazo para portal:');const response=await api('/api/review-document-submission',{submission_id:button.dataset.id,decision:button.dataset.review,reviewer_note:note||null});if(!response.ok)return notice(response.error,'error');await load();render();notice(button.dataset.review==='approved'?'Documento aprobado.':'Documento rechazado.');}));
  document.querySelectorAll('[data-release-doc]').forEach(button=>button.addEventListener('click',async()=>{const {error}=await sb.from('portal_document_releases').insert({document_id:button.dataset.releaseDoc,patient_id:button.dataset.patient,released_to:'patient',active:true});if(error)return notice(friendly(error),'error');notice('Documento liberado al paciente.');}));
  document.getElementById('programForm')?.addEventListener('submit',async event=>{event.preventDefault();const data=pick(event.currentTarget,['name','duration_weeks','description']);data.slug=data.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');data.active=true;try{await save('programs',data,'Programa guardado.');}catch(error){notice(friendly(error),'error');}});
  bindAccess();
  document.getElementById('chargeForm')?.addEventListener('submit',async event=>{event.preventDefault();const data=pick(event.currentTarget,['patient_id','category','description','amount','currency','due_date']);data.patient_id=data.patient_id||null;data.due_date=data.due_date||null;data.amount=Number(data.amount);try{await save('financial_charges',data,'Cargo registrado.');}catch(error){notice(friendly(error),'error');}});
  document.getElementById('paymentForm')?.addEventListener('submit',async event=>{event.preventDefault();const data=pick(event.currentTarget,['charge_id','patient_id','amount','method','reference','payer_name','notes']);data.charge_id=data.charge_id||null;data.patient_id=data.patient_id||null;data.amount=Number(data.amount);data.status='confirmed';try{await save('financial_payments',data,'Pago manual registrado y conciliado.');}catch(error){notice(friendly(error),'error');}});
  document.querySelectorAll('[data-pay-charge]').forEach(button=>button.addEventListener('click',()=>{const form=document.getElementById('paymentForm');form.charge_id.value=button.dataset.payCharge;form.patient_id.value=button.dataset.patient||'';form.scrollIntoView({behavior:'smooth'});}));
  document.getElementById('communicationForm')?.addEventListener('submit',async event=>{event.preventDefault();const response=await api('/api/send-communication',pick(event.currentTarget,['title','body','audience','channel','patient_id']));if(!response.ok)return notice(response.error,'error');event.currentTarget.reset();notice(`Comunicado enviado a ${response.recipients} destinatarios.`);});
  document.querySelectorAll('[data-gcal-connect]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    const response=await api('/api/calendar-google-start',{professional_id:button.dataset.gcalConnect});
    button.disabled=false;
    if(!response.ok)return notice(response.error||'No se pudo iniciar la conexión con Google.','error');
    window.open(response.url,'_blank','noopener');
    notice('Completá la autorización en la ventana de Google y volvé a Actualizar.');
  }));
}
async function uploadInternalDocument(event) {
  event.preventDefault(); const form=event.currentTarget; const fd=new FormData(form); const file=fd.get('file'); let path=null;
  if(file?.name){
    if(file.size>10*1024*1024) return notice('El archivo supera el máximo de 10 MB.','error');
    path=`${fd.get('patient_id')}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'-')}`;
    const {error}=await sb.storage.from('clinical-documents').upload(path,file);
    if(error){
      if(/row-level security|violates/i.test(String(error.message))) return notice('El almacenamiento no tiene las políticas de acceso aplicadas. Un administrador debe crearlas en Supabase → Storage → Policies (ver Manual de uso).','error');
      return notice(friendly(error),'error');
    }
  }
  try{await save('patient_documents',{patient_id:fd.get('patient_id'),document_type_id:fd.get('document_type_id')||null,title:fd.get('title'),visibility:fd.get('visibility'),file_path:path,storage_bucket:'clinical-documents',mime_type:file?.type||null,size_bytes:file?.size||null,status:'cargado'},'Documento guardado en el legajo.');}catch(error){notice(friendly(error),'error');}
}
function bindAccess() {
  const form=document.getElementById('accessForm'); if(!form)return;
  const kind=document.getElementById('accessKind');
  const sync=()=>{
    const value=kind.value;const role=document.getElementById('accessRoleWrap');const linked=document.getElementById('accessLinkWrap');
    if(value==='patient'){role.innerHTML='Rol<input value="Paciente" disabled>';linked.innerHTML=`Vincular paciente<select name="patient_id" required>${selectOptions(state.patients,name)}</select>`;}
    if(value==='family'){role.innerHTML='Rol<input value="Familiar autorizado (portal)" disabled>';linked.innerHTML=`Paciente<select name="family_patient_id" id="familyPatient" required>${selectOptions(state.patients,name)}</select><div id="familyContactWrap"></div><label class="field inline"><input type="checkbox" name="can_view_documents"> Ver documentos liberados</label><label class="field inline"><input type="checkbox" name="can_upload_documents"> Cargar documentos solicitados</label>`;syncFamilyContacts();}
    if(value==='professional'){role.innerHTML=`Rol clínico<select name="role_code">${roles.filter(row=>['professional','medical','psychologist','social_worker','therapeutic_operator'].includes(row[0])).map(row=>`<option value="${row[0]}">${row[1]}</option>`).join('')}</select>`;linked.innerHTML=`Vincular profesional<select name="professional_id" required>${selectOptions(state.professionals,item=>item.full_name)}</select>`;}
    if(value==='internal'){role.innerHTML=`Rol<select name="role_code">${roles.filter(row=>['admission','finance','communications','direction','auditor'].includes(row[0])).map(row=>`<option value="${row[0]}">${row[1]}</option>`).join('')}</select>`;linked.innerHTML='Cuenta interna sin ficha clínica';}
  };
  const syncFamilyContacts=()=>{const patient=document.getElementById('familyPatient');const wrap=document.getElementById('familyContactWrap');if(!patient||!wrap)return;const contacts=state.contacts.filter(item=>item.patient_id===patient.value&&item.is_authorized&&item.can_access_portal);wrap.innerHTML=`Contacto autorizado<select name="patient_contact_id" required>${selectOptions(contacts,item=>`${item.full_name} · ${item.relationship||'referente'}`)}</select>`;patient.addEventListener('change',syncFamilyContacts,{once:true});};
  kind.addEventListener('change',sync);sync();
  form.addEventListener('submit',async event=>{event.preventDefault();const fd=new FormData(form);const body={kind:fd.get('kind'),email:fd.get('email'),password:fd.get('password'),full_name:fd.get('full_name'),role_code:fd.get('role_code')};if(body.kind==='patient')body.patient_id=fd.get('patient_id');if(body.kind==='professional')body.professional_id=fd.get('professional_id');if(body.kind==='family')body.authorizations=[{patient_id:fd.get('family_patient_id'),patient_contact_id:fd.get('patient_contact_id'),can_view_profile:true,can_view_appointments:true,can_receive_updates:true,can_view_documents:Boolean(fd.get('can_view_documents')),can_upload_documents:Boolean(fd.get('can_upload_documents'))}];const response=await api('/api/create-user',body);if(!response.ok)return notice(response.error,'error');await load();render();notice('Acceso creado de forma segura.');});
  document.querySelectorAll('[data-toggle-user]').forEach(button=>button.addEventListener('click',()=>updateAccess(button.dataset.toggleUser,{active:button.dataset.active==='true'})));
  document.querySelectorAll('[data-reset-user]').forEach(button=>button.addEventListener('click',()=>{const password=prompt('Nueva contraseña temporal (12+ caracteres, mayúscula, minúscula y número):');if(password)updateAccess(button.dataset.resetUser,{password});}));
}
async function updateAccess(userId,payload){const response=await api('/api/update-user-access',{user_id:userId,...payload});if(!response.ok)return notice(response.error,'error');await load();render();notice('Acceso actualizado.');}
async function api(url,body){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`},body:JSON.stringify(body)});let data={};try{data=await response.json();}catch{}return {ok:response.ok,...data};}
