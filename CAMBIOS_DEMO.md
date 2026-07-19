# Actualización de la demostración — resumen

Cambios aplicados para que la demo sirva como presentación a dueños y equipo de la fundación, con guía en pantalla, mini guía PDF, botón de restauración y una interfaz de ERP de salud.

## 1. Reset y datos de ejemplo (SQL)
- **Nuevo `supabase/sql/007_demo_reset.sql`**: define `seed_demo_data()`, `cleanup_demo_data()` y `reset_demo_data()`. Carga la demo completa **incluidas las finanzas** (un cargo con pago parcial conciliado), un documento liberado al portal y una solicitud de portal. Texto de ejemplo naturalizado (sin etiquetas de “prueba”).
- **`002_seed_demo.sql`** ahora solo deja la ficha de la organización; la carga completa vive en `007` (necesita tablas creadas en `004`).
- **`003_cleanup_demo.sql`** pasó a ser un envoltorio de `cleanup_demo_data()`.
- **Dos bugs bloqueantes corregidos** (reproducidos y verificados en Postgres real):
  - el trigger que protege la historia clínica impedía limpiar la demo;
  - borrar un paciente demo violaba una restricción por el perfil de portal asociado.
- El reset se probó punta a punta y es **idempotente** (ejecutarlo varias veces deja siempre el mismo estado).

### Orden de instalación
`001` → `002` → `004` → `005` → `006` → `007`

## 2. Restaurar demo (app)
- **Nuevo `api/reset-demo.js`**: elimina las cuentas `@senderos.demo`, ejecuta `reset_demo_data()` y recrea los accesos. Solo disponible con `ENABLE_DEMO_SETUP` activo, fuera de producción, y para Dirección.
- Botón **Restaurar demo** en la barra superior y en el panel de guía (visible solo para Dirección en modo demo).
- `api/init-demo-users.js` y `api/_auth.js` comparten ahora la lógica de provisión de usuarios demo.

## 3. Guía en pantalla + mini guía PDF
- **Bienvenida por rol** la primera vez que entra cada perfil (se recuerda por rol).
- Botón **Guía** que abre un panel con los pasos concretos del rol activo (dirección, coordinación, equipo clínico, admisión, finanzas, comunicaciones, auditoría; y en el portal: paciente / familiar).
- **`assets/guia-senderos.pdf`**: mini guía de 3 páginas descargable desde el sistema y el portal.

## 4. Interfaz (UI/UX de ERP de salud)
- Rediseño de `sistema/styles.css` y `portal/styles.css`: paleta clínica sobria, tipografía más densa, iconos en la navegación.
- Nuevo layout **“board”** (datos a un lado, formularios en un panel lateral contenido): elimina las tarjetas “chorizo” y los desbordes.
- Tablas contenidas con encabezado fijo y scroll propio; chips de estado con semántica clínica (verde / ámbar / rojo / info).
- Responsive verificado en escritorio y móvil (sin desbordes horizontales).

## Cómo probar
1. Ejecutar los SQL en el orden indicado.
2. Definir **`ENABLE_DEMO_SETUP=true`** en Vercel (en el Environment del despliegue, incluido Production) y volver a desplegar. Este único interruptor habilita los botones de acceso directo, la creación de accesos demo y el botón *Restaurar demo*.
3. Entrar a `/sistema/` y tocar un botón de acceso directo (Dirección, Profesional o Auditoría); en `/portal/`, el botón Paciente.
4. Recorrer con la **Guía**, descargar el **PDF** y usar **Restaurar demo** para volver al estado inicial.

> Para pasar a operación real, poner `ENABLE_DEMO_SETUP=false` (o quitar la variable): desaparecen los botones y se apagan los endpoints de demo.
