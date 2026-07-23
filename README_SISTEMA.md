# Senderos de Libertad - web + sistema

## Rutas

- Web pública: `/`
- Sistema interno: `/sistema/`
- Portal de pacientes/familiares: `/portal/`

La web pública mantiene su contenido institucional. Desde el menú y el inicio se accede al portal y al sistema interno.

## Variables en Vercel

```env
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE_KEY
ENABLE_DEMO_SETUP=true
```

`SUPABASE_SERVICE_ROLE_KEY` se usa solo en funciones server-side para crear credenciales desde el panel y preparar accesos demo.

## Supabase SQL Editor

Ejecutar en este orden:

1. `supabase/sql/001_schema.sql`
2. `supabase/sql/002_seed_demo.sql` (deja lista la ficha de la organización)
3. `supabase/sql/004_operational_hardening.sql`
4. `supabase/sql/005_finalize_hardening.sql`
5. `supabase/sql/006_portal_document_scopes.sql`
6. `supabase/sql/007_demo_reset.sql` (define las funciones de demo y **carga la demostración completa**, incluidas las finanzas)

> El archivo `007` es el que siembra los datos de ejemplo con `seed_demo_data()`. Debe ejecutarse después de `004`, porque la demo de pagos usa tablas creadas en ese archivo.

Para borrar los datos de ejemplo antes de iniciar la operación real:

7. `supabase/sql/003_cleanup_demo.sql` (llama a `cleanup_demo_data()` y retira todo lo marcado como demo). Luego eliminar las cuentas `@senderos.demo` desde *Authentication → Users* y desactivar `ENABLE_DEMO_SETUP`.

## Accesos demo

Después de ejecutar los SQL y desplegar en Vercel:

> **Importante:** los botones de acceso directo y el botón *Restaurar demo* solo aparecen si la variable de entorno **`ENABLE_DEMO_SETUP=true`** está definida en Vercel (en el mismo *Environment* del despliegue que estás mostrando, **incluido Production**). Después de agregarla, volvé a desplegar. Con `ENABLE_DEMO_SETUP=false` o sin definir, no se muestran: ese es el modo para la operación real.

1. Entrar a `/sistema/`.
2. Tocar uno de los **botones de acceso directo** (Dirección, Profesional o Auditoría): preparan los accesos si hace falta e inician sesión sin escribir nada.
3. También se puede ingresar manualmente con:

| Perfil | Email | Contraseña |
|---|---|---|
| Dirección | direccion@senderos.demo | Senderos2026! |
| Profesional | profesional@senderos.demo | Senderos2026! |
| Paciente | paciente@senderos.demo | Senderos2026! |
| Auditoría | auditoria@senderos.demo | Senderos2026! |

El mismo botón está disponible en `/portal/` para facilitar la presentación.

## Guía en pantalla y mini guía PDF

- Al ingresar por primera vez con cada rol se muestra una **bienvenida** con los primeros pasos de ese perfil (se recuerda por rol y no vuelve a aparecer).
- El botón **Guía** (arriba a la derecha y en el pie del menú lateral) abre en cualquier momento un panel con los pasos del rol activo.
- Desde ese panel se puede **descargar la mini guía** en PDF (`/assets/guia-senderos.pdf`): una recorrida de 3 páginas pensada para el equipo y la dirección.
- El portal de la persona y su familia también incluye su propia guía y el mismo PDF.

## Restaurar la demostración

Para volver la demo al estado de ejemplo antes o después de una presentación:

- Ingresar como **Dirección** y presionar **Restaurar demo** (aparece solo con `ENABLE_DEMO_SETUP` activo).
- El sistema elimina lo cargado durante la prueba, vuelve a sembrar las 4 personas, la agenda, la historia clínica, los documentos y las finanzas de ejemplo, y recrea los accesos `@senderos.demo`.
- Es una operación segura: solo toca datos de ejemplo, nunca información real que se haya cargado aparte.

## Qué datos demo quedan cargados

- Programas: prevención, orientación/tratamiento, acompañamiento familiar, reinserción social/laboral y programa online.
- Profesionales: psiquiatría, psicología, trabajo social, asistencia terapéutica, nutrición, musicoterapia, educación física, asesoría legal y voluntariado.
- Cuatro personas acompañadas (ejemplo) con turnos, programas, historia clínica, un documento liberado al portal, una solicitud de portal y finanzas de ejemplo (un cargo con un pago parcial conciliado).

## Operación desde el sistema

Desde `/sistema/` se puede:

- dar de alta pacientes;
- asignar programa inicial;
- asignar profesional responsable;
- crear acceso al portal;
- dar de alta profesionales;
- crear acceso al sistema para profesionales;
- agendar turnos;
- registrar evolución clínica;
- cargar documentos;
- liberar documentos al portal;
- registrar movimientos financieros;
- revisar auditoría.

## Auditoría sin historia clínica confidencial

El usuario de auditoría puede revisar actividad, pacientes, agenda, profesionales y programas. No tiene acceso al módulo de historia clínica ni a documentos privados clínicos.

Los perfiles clínicos y de coordinación sí pueden registrar y consultar información clínica según permisos.

## Imagen de familias

La imagen de familias está incluida localmente en assets/familia-acompanamiento.png


## Nota de despliegue Vercel

Los archivos de `/sistema` y `/portal` usan rutas absolutas para que funcionen tanto con `/sistema` como con `/sistema/`, evitando errores 404 de `app.js` o `styles.css`.


## Corrección anti 404 en Vercel

El repo incluye rutas absolutas para `/sistema/app.js` y `/portal/app.js`, más un `app.js` raíz de respaldo. Esto evita que Vercel cargue `/app.js` por error cuando se abre `/sistema` o `/portal` sin barra final.

## Versión 2.1 — agenda con horarios, grupos y Google Calendar

**Instalación de la actualización (una sola vez):**

1. Ejecutar `supabase/sql/008_grupos_y_agenda.sql` en el SQL Editor de Supabase. Esto:
   - Corrige el bug que impedía agendar turnos en la demo (faltaba la disponibilidad de los profesionales).
   - Crea talleres y terapia grupal con cupo e inscripciones (sistema y portal).
   - Activa el motor de horarios (`get_available_slots`) y la auto-reserva del portal.
   - Reintenta las políticas de Storage. **Si el resultado muestra el aviso de que no pudieron crearse**, crearlas a mano desde *Dashboard → Storage → Policies* (las expresiones están en el propio archivo 008); sin ellas, ninguna subida de archivos funciona.
2. Redesplegar en Vercel (el `vercel.json` ahora incluye el cron de sincronización).

**Variables de entorno nuevas (opcionales, solo para Google Calendar):**

| Variable | Uso |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Credenciales OAuth (Google Cloud → APIs → Calendar API, pantalla de consentimiento + cliente web con redirect `https://TU-DOMINIO/api/calendar-google-callback`). |
| `GOOGLE_TOKEN_KEY` | Clave para cifrar los refresh tokens (cualquier cadena larga aleatoria). |
| `GOOGLE_OAUTH_STATE_SECRET` | Firma del state de OAuth (cadena aleatoria). |
| `CRON_SECRET` | La define Vercel automáticamente para los crons; también puede fijarse a mano. |

Con esto, Dirección conecta el calendario de cada profesional desde **Agenda → Google Calendar**. Los eventos se publican como “Reservado — Senderos”, sin datos clínicos, cada 15 minutos.

## Revisión 2.2 — correcciones de punta a punta

1. **Portal: fuga de listeners al navegar entre secciones.** La tab-bar vive fuera del
   contenedor que se redibuja, pero se le volvía a enlazar el evento en cada cambio de
   sección: los manejadores se duplicaban de forma exponencial y el portal terminaba
   trabándose en el celular tras una decena de toques. Ahora la navegación se resuelve
   por delegación, enlazada una sola vez.
2. **Zona horaria unificada.** Todo se muestra y se guarda en la hora de la clínica
   (`ORGANIZATION_TIMEZONE`), no en la del navegador. Antes, alguien conectado desde otro
   país veía y cargaba los horarios corridos.
3. **Bloqueos de agenda con hora corrida.** Los campos `datetime-local` se enviaban sin
   zona y Postgres los interpretaba como UTC: un bloqueo cargado a las 18:00 quedaba a las
   15:00. Ahora se convierten a hora de la clínica antes de guardar, y se valida que el fin
   sea posterior al inicio.
4. **Auditoría inundada.** `/api/init-demo-users` corre en cada clic de los botones demo y
   registraba un evento siempre. Ahora solo registra cuando realmente crea cuentas.
5. **Auditoría legible.** Las acciones se muestran con nombre en castellano (el código
   técnico queda como referencia) y las acciones del sistema figuran como "sistema" en vez
   de un guion.
6. **Estado del portal al cerrar sesión.** El reinicio perdía claves nuevas del estado
   (`groups`, `professionals`, `appointmentTypes`); ahora hay un único punto de definición.

## Revisión 2.3 — la interfaz refleja los permisos reales

El sistema mostraba formularios y botones a roles que la base de datos rechaza por RLS.
La persona completaba el formulario y recibía un error técnico sin entender por qué. Era el
mismo problema que reportó el dueño de la clínica al principio ("no pude cargar nada").

Ahora cada formulario y cada botón está condicionado por el mismo predicado que su política
SQL, y cuando un rol no puede ejecutar una acción ve una explicación en castellano en lugar
del formulario.

| Acción | Quién puede (SQL) |
| --- | --- |
| Alta de paciente, referente y programa | Dirección, Coordinación clínica, Admisión |
| Alta de profesional y programas | Dirección, Coordinación clínica |
| Agendar, disponibilidad, bloqueos, grupos | Los anteriores + Admisión + equipo clínico (solo su propia agenda) |
| Historia clínica | Dirección, Coordinación clínica, equipo clínico (solo pacientes asignados) |
| Documentos | Los anteriores + Admisión |
| Pagos | Dirección, Finanzas |
| Comunicados | Dirección, Coordinación, Admisión, Comunicaciones |
| Activar/desactivar cuentas y restablecer contraseñas | Solo Dirección |
| Crear cuentas de auditoría | Solo super_admin |

Además, los desplegables de profesional quedaron acotados: el equipo clínico solo puede
agendar, publicar grupos y cargar disponibilidad sobre su propia agenda, que es lo que
permite `can_manage_professional_schedule()`. Antes ofrecía a todo el equipo y fallaba al
confirmar.

**Pestaña Profesionales:** para el equipo clínico ahora abre con *Mi ficha* (personas a
cargo, turnos y grupos próximos, disponibilidad propia con aviso si no está cargada) y
debajo el directorio del equipo. Para administración sigue siendo el directorio y el alta.
