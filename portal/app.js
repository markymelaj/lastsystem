const root = document.getElementById('portal');
let sb; let session; let profile; let config = {}; let selectedPatientId = null;
let state = { patients:[], appointments:[], documents:[], requirements:[], submissions:[], requests:[], messages:[], professionals:[], appointmentTypes:[], groups:[] };
function friendly(error){
  const raw=String(error?.message||error||'');
  if(/row-level security/i.test(raw))return 'Esta cuenta no tiene permiso para esa acción.';
  if(/mime type|not supported/i.test(raw))return 'Formato no admitido. Subí PDF, JPG, PNG o WebP (hasta 10 MB).';
  if(/payload too large|exceeded/i.test(raw))return 'El archivo supera el máximo de 10 MB.';
  return raw||'No se pudo completar la acción.';
}
function timeShort(value){return value?new Date(value).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}):'-';}
function localDateKey(value){const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}

function esc(value=''){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[char]));}
function dateTime(value){return value?new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'-';}
function tag(value){return `<span class="tag">${esc(value||'-')}</span>`;}
function table(headers,rows){return rows.length?`<div class="table-wrap"><table><thead><tr>${headers.map(item=>`<th>${item}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell??'-'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="empty">Sin registros</div>';}
function patientName(patient){return patient?`${patient.first_name||''} ${patient.last_name||''}`.trim():'-';}

// ---------------------------------------------------------------
// Guía in-app del portal (paciente / familiar autorizado)
// ---------------------------------------------------------------
const PORTAL_GUIDES = {
  patient:{ title:'Tu portal, paso a paso',
    intro:'Acá ves tus turnos, descargás los documentos que el equipo habilita y subís lo que te piden. No se muestran evoluciones ni notas clínicas.',
    steps:[
      ['Sacá tu turno','En “Sacar un turno” elegís profesional, tipo y día, y ves solo los horarios libres. El equipo lo confirma y te aparece en tu lista.'],
      ['Sumate a talleres y grupos','En “Talleres y terapia grupal” ves los espacios abiertos con su cupo. Te inscribís con un botón y podés cancelar hasta el inicio.'],
      ['Descargá tus documentos','Los documentos que el equipo libera aparecen listos para descargar.'],
      ['Subí lo que te solicitan','Si hay documentación pendiente, adjuntás el archivo desde “Documentos solicitados”.'],
      ['Escribí al equipo','Con “Nueva solicitud” pedís una corrección o hacés una consulta.']
    ]},
  family:{ title:'Portal para familiares',
    intro:'Como familiar autorizado acompañás el proceso: consultás turnos, documentos habilitados y comunicados de la persona vinculada.',
    steps:[
      ['Elegí a la persona','Si acompañás a más de una, la seleccionás arriba para ver su información.'],
      ['Seguí los turnos','Consultás los próximos encuentros y su estado.'],
      ['Colaborá con la documentación','Según la autorización, podés ver o subir los documentos solicitados.'],
      ['Mantené el contacto','Enviás solicitudes y leés los comunicados que habilita la clínica.']
    ]}
};
function portalGuide(){ return PORTAL_GUIDES[profile?.account_kind==='family'?'family':'patient']; }
function helpPanelHtml(){
  const g=portalGuide();
  const steps=g.steps.map((s,i)=>`<div class="help-step"><span class="n">${i+1}</span><h4>${esc(s[0])}</h4><p>${esc(s[1])}</p></div>`).join('');
  return `<div class="help-overlay" data-help-overlay></div><aside class="help-panel" id="helpPanel" aria-label="Guía del portal">
    <div class="help-head"><div><p class="eyebrow">Guía del portal</p><h2>${esc(g.title)}</h2></div><button class="help-close" data-help-close aria-label="Cerrar">&times;</button></div>
    <div class="help-body"><p class="help-intro">${esc(g.intro)}</p>${steps}</div>
    <div class="help-foot"><a class="btn secondary full" href="/assets/guia-senderos.pdf" target="_blank" rel="noopener">Descargar mini guía (PDF)</a><p class="help-cred">Fundación Senderos de Libertad</p></div>
  </aside>`;
}
function welcomeModalHtml(){
  const g=portalGuide();
  const bullets=g.steps.slice(0,3).map(s=>`<li>${esc(s[0])}</li>`).join('');
  return `<div class="modal-overlay" id="welcomeModal"><div class="modal">
    <div class="modal-top"><p class="eyebrow">Te damos la bienvenida</p><h2>${esc(g.title)}</h2></div>
    <div class="modal-body"><p>${esc(g.intro)}</p><ul class="modal-list">${bullets}</ul>
    <p class="muted">Podés volver a abrir esta guía desde el botón <strong>Guía</strong>.</p></div>
    <div class="modal-foot"><button class="btn secondary" data-welcome-close>Explorar</button><button class="btn primary" data-welcome-guide>Ver la guía</button></div>
  </div></div>`;
}
function welcomeKey(){ return `senderos_portal_welcome_${profile?.account_kind||'x'}`; }
function maybeShowWelcome(){
  try{ if(localStorage.getItem(welcomeKey()))return; }catch(e){}
  const host=document.getElementById('modalHost'); if(!host)return;
  host.innerHTML=welcomeModalHtml();
  const overlay=document.getElementById('welcomeModal');
  requestAnimationFrame(()=>overlay.classList.add('open'));
  const dismiss=()=>{ try{localStorage.setItem(welcomeKey(),'1');}catch(e){} overlay.classList.remove('open'); setTimeout(()=>host.innerHTML='',200); };
  overlay.querySelector('[data-welcome-close]').addEventListener('click',dismiss);
  overlay.addEventListener('click',e=>{ if(e.target===overlay)dismiss(); });
  overlay.querySelector('[data-welcome-guide]').addEventListener('click',()=>{ dismiss(); openHelp(); });
}
function openHelp(){ document.getElementById('helpPanel')?.classList.add('open'); document.querySelector('[data-help-overlay]')?.classList.add('open'); }
function closeHelp(){ document.getElementById('helpPanel')?.classList.remove('open'); document.querySelector('[data-help-overlay]')?.classList.remove('open'); }

init();
async function init(){
  try{
    config=await (await fetch('/api/public-config')).json();
    if(!config.supabaseUrl||!config.supabaseAnonKey)throw new Error('Portal no configurado.');
    sb=window.supabase.createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data}=await sb.auth.getSession();session=data.session;
    sb.auth.onAuthStateChange(async(_event,next)=>{session=next;if(next)await load();else{profile=null;state={patients:[],appointments:[],documents:[],requirements:[],submissions:[],requests:[],messages:[]};}render();});
    if(session)await load();render();
  }catch(error){root.innerHTML=`<main class="login"><section class="login-card"><h1>Portal no disponible</h1><p>${esc(error.message)}</p></section></main>`;}
}
async function query(request){const result=await request;return result.error?[]:(result.data||[]);}
async function load(){
  const profileResult=await sb.from('user_profiles').select('*').eq('id',session.user.id).maybeSingle();profile=profileResult.data||null;
  if(!profile)return;
  let patients=[];
  if(profile.account_kind==='patient'&&profile.patient_id){const result=await sb.from('patients').select('*').eq('id',profile.patient_id).maybeSingle();if(result.data)patients=[result.data];}
  if(profile.account_kind==='family'){patients=await query(sb.from('family_authorizations').select('patient_id,patients(*)').eq('user_id',session.user.id).eq('active',true));patients=patients.map(item=>item.patients).filter(Boolean);}
  state.patients=patients;
  if(!selectedPatientId||!patients.some(item=>item.id===selectedPatientId))selectedPatientId=patients[0]?.id||null;
  if(!selectedPatientId){state={...state,appointments:[],documents:[],requirements:[],submissions:[],requests:[],messages:[]};return;}
  const results=await Promise.all([
    query(sb.from('appointments').select('*,professionals(full_name),appointment_types(name)').eq('patient_id',selectedPatientId).order('start_at').limit(100)),
    query(sb.from('patient_documents').select('*').eq('patient_id',selectedPatientId).order('created_at',{ascending:false}).limit(100)),
    query(sb.from('document_requirements').select('*').eq('patient_id',selectedPatientId).in('status',['requested','rejected']).order('created_at',{ascending:false})),
    query(sb.from('portal_document_submissions').select('*,document_requirements(title)').eq('patient_id',selectedPatientId).order('created_at',{ascending:false})),
    query(sb.from('portal_requests').select('*').eq('patient_id',selectedPatientId).order('created_at',{ascending:false})),
    query(sb.from('communication_recipients').select('*,communications(title,body,created_at)').eq('user_id',session.user.id).order('created_at',{ascending:false}).limit(100)),
    query(sb.from('professionals').select('id,full_name,role_title,specialty').eq('active',true).order('full_name')),
    query(sb.from('appointment_types').select('id,name,default_minutes').eq('active',true).order('name')),
    query(sb.rpc('get_open_group_sessions',{p_patient_id:selectedPatientId}))
  ]);
  [state.appointments,state.documents,state.requirements,state.submissions,state.requests,state.messages,state.professionals,state.appointmentTypes,state.groups]=results;
}
function render(){
  if(!session){root.innerHTML=login();bindLogin();return;}
  if(!profile){root.innerHTML='<main class="login"><section class="login-card"><p>Cuenta sin perfil de portal.</p></section></main>';return;}
  if(profile.account_kind==='internal'){window.location.href='/sistema/';return;}
  root.innerHTML=shell();bind();maybeShowWelcome();
}
function login(){
  const demo=config.demoEnabled?`<div class="demo-box"><p>Entrá con un clic a la vista de la persona:</p><div class="demo-grid"><button type="button" data-demo-login="paciente@senderos.demo"><strong>Paciente</strong><span>Turnos, documentos y comunicados</span></button></div></div>`:'';
  return `<main class="login"><section class="login-card"><img src="../assets/logo-senderos.png" alt=""><h1>Portal seguro</h1><p>Turnos, documentos solicitados y comunicados autorizados por la clínica.</p><form id="login" class="form"><label class="field">Email<input name="email" type="email" required></label><label class="field">Contraseña<input name="password" type="password" required></label><button class="btn primary">Ingresar</button></form>${demo}<a class="back-link" href="/">Volver a la web</a></section></main>`;
}
const PORTAL_SECTIONS = [
  ['home','Inicio','<path d="M12 3 3 10v10a1 1 0 0 0 1 1h6v-6h4v6h6a1 1 0 0 0 1-1V10Z"/>'],
  ['book','Reservar','<path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2Zm12 7v10H5V9Zm-7 2-1.4 4.2L6 15l4 4 6-7Z"/>'],
  ['docs','Documentos','<path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V7h3.5ZM8 12h8v2H8Zm0 4h8v2H8Z"/>'],
  ['msgs','Mensajes','<path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 1-2Zm3 6v2h10V9Zm0 4v2h6v-2Z"/>']
];
let portalSection = 'home';
function portalNavIcon(path){ return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${path}</svg>`; }

function shell(){
  const patient=state.patients.find(item=>item.id===selectedPatientId);
  const isPatient=profile?.account_kind==='patient';
  const sections=PORTAL_SECTIONS.filter(([id])=>!(id==='book'&&!isPatient));
  const pendingDocs=state.requirements.length;
  const unreadMsgs=state.messages.filter(m=>!m.read_at).length;
  const badge=(id)=>{ const n=id==='docs'?pendingDocs:id==='msgs'?unreadMsgs:0; return n?`<span class="tabbadge">${n>9?'9+':n}</span>`:''; };
  const tabbar=sections.map(([id,label,icon])=>`<button class="tabitem ${portalSection===id?'active':''}" data-section="${id}">${portalNavIcon(icon)}<span>${label}</span>${badge(id)}</button>`).join('');
  const picker=state.patients.length>1
    ? `<label class="patient-switch">Persona vinculada<select id="patientSelect">${state.patients.map(item=>`<option value="${item.id}" ${item.id===selectedPatientId?'selected':''}>${esc(patientName(item))}</option>`).join('')}</select></label>`
    : '';
  return `<div class="portal"><header class="p-top"><div class="brand"><img src="../assets/logo-senderos.png" alt=""><div class="brand-txt"><strong>Senderos de Libertad</strong><small>Portal seguro · ${profile.account_kind==='family'?'familiar autorizado':'paciente'}</small></div></div><div class="p-top-actions"><button class="icon-btn" data-help-open title="Guía" aria-label="Guía">${portalNavIcon('<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.9 15h-1.8v-1.8h1.8Zm1.3-6.2-.8.8c-.6.6-.9 1.1-.9 2.2h-1.8v-.4c0-.9.4-1.6 1-2.2l1.1-1.1a1.6 1.6 0 0 0 .5-1.2A1.7 1.7 0 0 0 12 7a1.7 1.7 0 0 0-1.7 1.7H8.5A3.5 3.5 0 0 1 12 5.2a3.4 3.4 0 0 1 3.5 3.4c0 .8-.3 1.5-.9 2.1Z"/>')}</button><button class="icon-btn" id="logout" title="Salir" aria-label="Salir">${portalNavIcon('<path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5v-2H5V5h5V3Zm6.2 4.2-1.4 1.4L17.2 11H9v2h8.2l-2.4 2.4 1.4 1.4L21 12Z"/>')}</button></div></header>${picker}<div id="msg"></div><main class="p-main">${sectionView(portalSection,patient)}</main><nav class="tabbar" style="--tabs:${sections.length}">${tabbar}</nav></div>${helpPanelHtml()}<div id="modalHost"></div>`;
}

function sectionView(id,patient){
  if(id==='home') return homeSection(patient);
  if(id==='book') return bookSection();
  if(id==='docs') return docsSection();
  if(id==='msgs') return msgsSection();
  return '';
}

function greeting(){ const h=new Date().getHours(); return h<12?'Buenos días':h<20?'Buenas tardes':'Buenas noches'; }

function homeSection(patient){
  const firstName=(profile.full_name||'').trim().split(/\s+/)[0]||'';
  const upcoming=[...state.appointments].filter(a=>new Date(a.start_at)>=new Date()&&a.status!=='cancelado').slice(0,4);
  const openGroups=state.groups.filter(g=>{const enrolled=g.my_status&&g.my_status!=='cancelado';return enrolled;});
  return `<section class="sec"><div class="hero"><p class="hi">${greeting()}${firstName?`, ${esc(firstName)}`:''}</p><h1>${esc(profile.full_name||'Portal')}</h1><p class="hero-sub">Acá ves tus turnos, documentos y mensajes. No se publican evoluciones ni notas clínicas.</p></div>
  <div class="sec-head"><h2>Próximos turnos</h2>${profile.account_kind==='patient'?`<button class="link-btn" data-section="book">+ Reservar</button>`:''}</div>
  ${upcoming.length?`<div class="stack">${upcoming.map(apptCard).join('')}</div>`:`<div class="empty">No tenés turnos próximos${profile.account_kind==='patient'?'. Tocá <strong>Reservar</strong> para pedir uno.':'.'}</div>`}
  ${openGroups.length?`<div class="sec-head mt"><h2>Tus talleres y grupos</h2></div><div class="stack">${openGroups.map(g=>groupCard(g)).join('')}</div>`:''}
  </section>`;
}

function apptCard(item){
  const d=new Date(item.start_at);
  const day=d.toLocaleDateString('es-AR',{weekday:'short',day:'numeric',month:'short'});
  return `<article class="ecard"><div class="ecard-date"><span class="ecard-d">${d.getDate()}</span><span class="ecard-m">${d.toLocaleDateString('es-AR',{month:'short'})}</span></div><div class="ecard-body"><strong>${esc(item.appointment_types?.name||'Turno')}</strong><small>${esc(item.professionals?.full_name||'-')}</small><small class="ecard-when">${day} · ${timeShort(item.start_at)}</small></div>${tag(item.status)}</article>`;
}
function bookingCard(){
  if(profile?.account_kind!=='patient')return '<div class="empty">La reserva de turnos se coordina con el equipo.</div>';
  const today=localDateKey(new Date());
  return `<div class="sec-head"><h2>Sacar un turno</h2></div><p class="sub">Elegí profesional, tipo y día: vas a ver solo los horarios libres. El equipo confirma cada turno.</p><form id="bookingForm" class="form card-form"><label class="field">Profesional<select id="bkProfessional" required><option value="">Elegir…</option>${state.professionals.map(item=>`<option value="${item.id}">${esc(item.full_name)} · ${esc(item.role_title||'')}</option>`).join('')}</select></label><label class="field">Tipo de turno<select id="bkType" required>${state.appointmentTypes.map(item=>`<option value="${item.id}" data-minutes="${item.default_minutes||50}">${esc(item.name)}</option>`).join('')}</select></label><label class="field">Día<input type="date" id="bkDate" min="${today}" required></label><div class="field"><span>Horarios disponibles</span><div id="bkSlots" class="slot-grid"><p class="muted">Elegí profesional y día para ver los horarios.</p></div></div><label class="field">Motivo (opcional)<input id="bkReason" maxlength="200" placeholder="Ej.: seguimiento, consulta puntual"></label><input type="hidden" id="bkStart"><button class="btn primary full" id="bkSubmit" disabled>Elegí un horario</button></form>`;
}
function bookSection(){
  return `<section class="sec">${bookingCard()}<div class="sec-head mt"><h2>Talleres y terapia grupal</h2></div><p class="sub">Espacios grupales abiertos por la clínica. Inscribite mientras haya cupo; podés cancelar hasta el inicio.</p>${groupsList()}</section>`;
}
function docsSection(){
  return `<section class="sec"><div class="sec-head"><h2>Documentos solicitados</h2>${state.requirements.length?`<span class="count-pill">${state.requirements.length}</span>`:''}</div><p class="sub">Lo que el equipo te pidió adjuntar.</p>${requirements()}<div class="sec-head mt"><h2>Documentos disponibles</h2></div><p class="sub">Descargá lo que la clínica habilita para vos.</p>${documents()}</section>`;
}
function msgsSection(){
  return `<section class="sec"><div class="sec-head"><h2>Comunicados</h2></div>${messages()}<div class="sec-head mt"><h2>Nueva solicitud</h2></div><p class="sub">Pedí una corrección o hacé una consulta al equipo.</p><form id="requestForm" class="form card-form"><label class="field">Tipo<select name="request_type"><option value="turno">Turno</option><option value="documento">Documento</option><option value="datos">Corrección de datos</option><option value="otro">Otro</option></select></label><label class="field">Asunto<input name="subject" required></label><label class="field">Mensaje<textarea name="message" rows="4" required></textarea></label><button class="btn primary full">Enviar solicitud</button></form>${state.requests.length?`<div class="sec-head mt"><h2>Solicitudes enviadas</h2></div><div class="stack">${state.requests.map(item=>`<article class="ecard sm"><div class="ecard-body"><strong>${esc(item.subject)}</strong><small>${esc(item.request_type)} · ${dateTime(item.created_at)}</small></div>${tag(item.status)}</article>`).join('')}</div>`:''}</section>`;
}
function groupCard(item){
  const spots=Math.max(0,item.capacity-Number(item.enrolled_count||0));
  const enrolled=item.my_status&&item.my_status!=='cancelado';
  const isFamily=profile?.account_kind==='family';
  const action=enrolled
    ?`<span class="tag ok">Inscripto/a</span>${isFamily?'':`<button class="btn secondary" data-group-cancel="${item.my_enrollment_id}">Cancelar</button>`}`
    :(spots>0
      ?(isFamily?'<span class="tag">Se coordina con el equipo</span>':`<button class="btn primary" data-group-enroll="${item.id}">Inscribirme</button>`)
      :'<span class="tag">Sin cupo</span>');
  return `<article class="gcard"><div class="gcard-body"><strong>${esc(item.title)}</strong><small>${item.session_type==='taller'?'Taller':'Terapia grupal'} · ${esc(item.professional_name||'-')}${item.room_name?` · ${esc(item.room_name)}`:''}</small><small class="ecard-when">${dateTime(item.start_at)} a ${timeShort(item.end_at)}</small><small>${spots} cupo(s) disponible(s)</small>${item.description?`<small class="gcard-desc">${esc(item.description)}</small>`:''}</div><div class="gcard-action">${action}</div></article>`;
}
async function refreshPortalSlots(){
  const grid=document.getElementById('bkSlots');if(!grid)return;
  const professional=document.getElementById('bkProfessional')?.value;
  const date=document.getElementById('bkDate')?.value;
  const minutes=Number(document.getElementById('bkType')?.selectedOptions?.[0]?.dataset?.minutes||50);
  const submit=document.getElementById('bkSubmit');
  document.getElementById('bkStart').value='';
  if(submit){submit.disabled=true;submit.textContent='Elegí un horario';}
  if(!professional||!date){grid.innerHTML='<p class="muted">Elegí profesional y día para ver los horarios.</p>';return;}
  grid.innerHTML='<p class="muted">Buscando horarios libres…</p>';
  const {data,error}=await sb.rpc('get_available_slots',{p_professional_id:professional,p_date:date,p_duration_minutes:minutes});
  if(error){grid.innerHTML=`<p class="muted">${esc(friendly(error))}</p>`;return;}
  if(!data?.length){grid.innerHTML='<p class="muted">Sin horarios libres ese día. Probá con otro día.</p>';return;}
  grid.innerHTML=data.map(slot=>`<button type="button" class="slot" data-start="${slot.slot_start}">${timeShort(slot.slot_start)}</button>`).join('');
  grid.querySelectorAll('.slot').forEach(button=>button.addEventListener('click',()=>{
    grid.querySelectorAll('.slot').forEach(item=>item.classList.remove('picked'));
    button.classList.add('picked');
    document.getElementById('bkStart').value=button.dataset.start;
    if(submit){submit.disabled=false;submit.textContent=`Solicitar turno · ${timeShort(button.dataset.start)}`;}
  }));
}
function groupsList(){
  if(!state.groups.length)return '<div class="empty">Por ahora no hay talleres ni grupos abiertos</div>';
  return `<div class="stack">${state.groups.map(item=>groupCard(item)).join('')}</div>`;
}
function documents(){
  if(!state.documents.length)return '<div class="empty">Sin documentos liberados</div>';
  return `<div class="doc-list">${state.documents.map(item=>`<button class="doc-row" data-download="${item.id}"><strong>${esc(item.title)}</strong><small>Descargar</small></button>`).join('')}</div>`;
}
function requirements(){
  if(!state.requirements.length)return '<div class="empty">No hay documentación pendiente</div>';
  return `<div class="list">${state.requirements.map(item=>`<div class="item"><div><strong>${esc(item.title)}</strong><small>${esc(item.instructions||'')}</small><small>Vence: ${item.due_date||'sin fecha'}</small></div><form class="uploadRequirement" data-requirement="${item.id}"><input type="file" name="file" accept=".pdf,image/png,image/jpeg,image/webp" required><button class="btn secondary">Subir</button></form></div>`).join('')}</div>`;
}
function messages(){
  if(!state.messages.length)return '<div class="empty">Sin comunicados</div>';
  return `<div class="list">${state.messages.map(item=>`<button class="item" data-read="${item.id}"><div><strong>${esc(item.communications?.title||'Comunicado')}</strong><small>${esc(item.communications?.body||'')}</small></div><span>${item.read_at?'Leído':'Nuevo'}</span></button>`).join('')}</div>`;
}
function message(text,type=''){const el=document.getElementById('msg');if(el)el.innerHTML=`<div class="notice ${type==='error'?'error':''}">${esc(text)}</div>`;}
function bindLogin(){
  document.getElementById('login')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const {error}=await sb.auth.signInWithPassword({email:data.get('email'),password:data.get('password')});if(error){root.innerHTML=login();bindLogin();alert('No se pudo iniciar sesión. Revisá el email y la contraseña.');}});
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
function bind(){
  document.getElementById('logout')?.addEventListener('click',()=>sb.auth.signOut());
  document.querySelectorAll('[data-help-open]').forEach(button=>button.addEventListener('click',openHelp));
  document.querySelector('[data-help-close]')?.addEventListener('click',closeHelp);
  document.querySelector('[data-help-overlay]')?.addEventListener('click',closeHelp);
  document.getElementById('patientSelect')?.addEventListener('change',async event=>{selectedPatientId=event.target.value;await load();render();});
  bindSection();
}
function goToSection(id){
  portalSection=id;
  const main=document.querySelector('.p-main');
  const patient=state.patients.find(item=>item.id===selectedPatientId);
  if(main){main.innerHTML=sectionView(portalSection,patient);main.scrollTop=0;window.scrollTo(0,0);}
  document.querySelectorAll('.tabitem').forEach(t=>t.classList.toggle('active',t.dataset.section===portalSection));
  bindSection();
}
function bindSection(){
  document.querySelectorAll('[data-section]').forEach(button=>button.addEventListener('click',()=>goToSection(button.dataset.section)));
  document.getElementById('requestForm')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const {error}=await sb.from('portal_requests').insert({patient_id:selectedPatientId,request_type:data.get('request_type'),subject:data.get('subject'),message:data.get('message'),requester_user_id:session.user.id});if(error)return message(error.message,'error');await load();render();message('Solicitud enviada.');});
  document.querySelectorAll('[data-download]').forEach(button=>button.addEventListener('click',()=>downloadDocument(button.dataset.download)));
  document.querySelectorAll('.uploadRequirement').forEach(form=>form.addEventListener('submit',event=>uploadRequirement(event,form.dataset.requirement)));
  document.querySelectorAll('[data-read]').forEach(button=>button.addEventListener('click',async()=>{await sb.rpc('mark_communication_read',{p_recipient_id:button.dataset.read});await load();render();}));
  ['bkProfessional','bkType','bkDate'].forEach(id=>document.getElementById(id)?.addEventListener('change',refreshPortalSlots));
  document.getElementById('bookingForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const start=document.getElementById('bkStart').value;
    if(!start)return message('Elegí un horario disponible.','error');
    const {error}=await sb.rpc('request_appointment_portal',{
      p_professional_id:document.getElementById('bkProfessional').value,
      p_appointment_type_id:document.getElementById('bkType').value,
      p_start_at:start,
      p_modality:'presencial',
      p_reason:document.getElementById('bkReason').value||null
    });
    if(error)return message(friendly(error),'error');
    await load();render();message('Turno solicitado. El equipo lo va a confirmar y lo vas a ver en tu lista de turnos.');
  });
  document.querySelectorAll('[data-group-enroll]').forEach(button=>button.addEventListener('click',async()=>{
    button.disabled=true;
    const {error}=await sb.rpc('enroll_group_session',{p_session_id:button.dataset.groupEnroll,p_patient_id:selectedPatientId});
    if(error){button.disabled=false;return message(friendly(error),'error');}
    await load();render();message('Inscripción confirmada. ¡Te esperamos!');
  }));
  document.querySelectorAll('[data-group-cancel]').forEach(button=>button.addEventListener('click',async()=>{
    if(!confirm('¿Cancelar tu inscripción a este espacio?'))return;
    const {error}=await sb.rpc('cancel_group_enrollment',{p_enrollment_id:button.dataset.groupCancel});
    if(error)return message(friendly(error),'error');
    await load();render();message('Inscripción cancelada.');
  }));
}
async function uploadRequirement(event,requirementId){
  event.preventDefault();const file=new FormData(event.currentTarget).get('file');if(!file?.name)return;
  if(file.size>10*1024*1024)return message('El archivo supera 10 MB.','error');
  const path=`${session.user.id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'-')}`;
  const {error:uploadError}=await sb.storage.from('portal-submissions').upload(path,file);
  if(uploadError){
    if(/row-level security|violates/i.test(String(uploadError.message)))return message('La subida no está habilitada todavía. Avisale a la clínica: falta aplicar las políticas de almacenamiento.','error');
    return message(friendly(uploadError),'error');
  }
  const {error}=await sb.from('portal_document_submissions').insert({requirement_id:requirementId,patient_id:selectedPatientId,submitted_by:session.user.id,file_path:path,original_filename:file.name,mime_type:file.type,size_bytes:file.size});
  if(error)return message(friendly(error),'error');
  await load();render();message('Archivo recibido. El equipo lo revisará antes de incorporarlo al legajo.');
}
async function downloadDocument(documentId){
  const response=await fetch('/api/document-download',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`},body:JSON.stringify({document_id:documentId})});
  const data=await response.json();if(!response.ok)return message(data.error||'No se pudo abrir el documento.','error');window.open(data.url,'_blank','noopener');
}

