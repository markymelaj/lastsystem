# Flujos operativos

## Crear paciente con acceso al portal

1. Ingresar a `/sistema/` como Dirección o Coordinación clínica.
2. Ir a `Pacientes`.
3. Completar la ficha.
4. Elegir programa inicial.
5. Elegir profesional responsable.
6. Marcar `Crear acceso al portal ahora`.
7. Cargar email y contraseña inicial.
8. Guardar.

Resultado:

- Se crea el paciente.
- Se asigna programa si fue seleccionado.
- Se crea usuario en Supabase Auth.
- Se crea `user_profiles` vinculado al `patient_id`.

## Crear profesional con acceso interno

1. Ingresar a `/sistema/` como Dirección o Coordinación clínica.
2. Ir a `Profesionales`.
3. Completar ficha profesional.
4. Marcar `Crear acceso al sistema ahora`.
5. Seleccionar rol.
6. Cargar contraseña inicial.
7. Guardar.

Resultado:

- Se crea el profesional.
- Se crea usuario en Supabase Auth.
- Se crea `user_profiles` vinculado al `professional_id`.

## Crear credencial después

1. Ir a `Accesos`.
2. Elegir tipo: paciente, familiar autorizado o profesional.
3. Elegir rol.
4. Vincular con paciente/profesional.
5. Cargar nombre, email y contraseña.
6. Guardar.

## Preparar demo

1. Ejecutar SQL de schema y seed.
2. Entrar a `/sistema/`.
3. Presionar `Preparar accesos demo`.
4. Ingresar con cualquiera de los accesos demo.

## Perfil auditoría

El auditor entra al sistema y puede revisar:

- dashboard;
- pacientes operativos;
- profesionales;
- turnos;
- programas;
- auditoría.

No debe acceder a:

- historia clínica;
- documentos clínicos privados;
- carga clínica.
