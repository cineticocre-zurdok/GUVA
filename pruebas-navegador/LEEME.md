# Prueba de navegador (opcional, solo para desarrollo)

Recorre la app como administrador, bodega y vendedor contra una base PostgreSQL local,
usando PostgREST (el mismo motor de API de Supabase) y un simulador mínimo de inicio de sesión.
Todos los datos son de PRUEBA. Nada de esto se usa en producción.

Requisitos: PostgreSQL 15+, PostgREST 12, Node 20+, Python 3 con `playwright` y Chrome.

1. Crear la base `guva_e2e`: stub + migraciones + `semilla.sql`.
2. `postgrest postgrest.conf` y `node auth_mock.mjs` (puerto 54321).
3. En `app/.env.local`: `VITE_SUPABASE_URL=http://localhost:54321` y cualquier texto como anon key.
4. `npm run dev` en `app/` y luego `python3 recorrido.py`.

Contraseña de todos los usuarios de prueba: `prueba123`.
