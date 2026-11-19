-- Usuarios de PRUEBA para la prueba de navegador (base guva_e2e, nunca producción)
do $$ begin
  if not exists (select 1 from pg_roles where rolname='authenticator') then
    create role authenticator login password 'e2e_local_solo_prueba' noinherit;
  end if;
end $$;
grant anon, authenticated to authenticator;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@prueba.local'),
  ('00000000-0000-0000-0000-00000000000b', 'bodega@prueba.local'),
  ('00000000-0000-0000-0000-000000000001', 'papa@prueba.local'),
  ('00000000-0000-0000-0000-000000000002', 'hijo1@prueba.local');
insert into perfiles (id, nombre, rol) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin PRUEBA', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', 'Bodega PRUEBA', 'bodega');
