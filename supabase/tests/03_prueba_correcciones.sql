-- GUVA · Prueba de las correcciones de la migración 0005 (base de PRUEBA)
-- Ejecutar después de 01 y 02 (reutiliza sus usuarios, productos y la jornada cerrada de V1).
\set QUIET on
\pset footer off
create or replace function pg_temp.como(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
end $$;
create or replace function pg_temp.espera_error(p_sql text, p_fragmento text) returns text
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALLA: se esperaba error "%" y la instrucción pasó', p_fragmento;
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
  if position(lower(p_fragmento) in lower(sqlerrm)) = 0 then
    raise exception 'FALLA: error inesperado: % (se esperaba "%")', sqlerrm, p_fragmento;
  end if;
  return 'OK (rechazado): ' || sqlerrm;
end $$;
create or replace function pg_temp.verifica(p_cond boolean, p_msg text) returns text
language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALLA: %', p_msg; end if;
  return 'OK: ' || p_msg;
end $$;

\echo '--- 16. Cancelaciones no alteran cierres de ruta'
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.espera_error($$select cancelar_gasto('cccccccc-0000-0000-0000-000000000001', '   ')$$, 'motivo');
select pg_temp.espera_error($$select cancelar_gasto('cccccccc-0000-0000-0000-000000000001', 'x')$$, 'cierre de ruta');
select pg_temp.espera_error($$select cancelar_pago('bbbbbbbb-0000-0000-0000-000000000001', 'x')$$, 'cierre de ruta');
select registrar_venta('{"id":"aaaaaaaa-0000-0000-0000-000000000020","canal":"mostrador",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1}],
  "pagos":[{"id":"bbbbbbbb-0000-0000-0000-000000000020","metodo":"efectivo","monto":15}]}')->>'folio' as mostrador;
select pg_temp.espera_error($$select cancelar_pago('bbbbbbbb-0000-0000-0000-000000000020', 'x')$$, 'venta de contado');

\echo '--- 17. Productos inactivos'
reset role;
update productos set activo = false where codigo_interno = 'DEMO-I1';
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.espera_error($$select registrar_venta(('{"id":"aaaaaaaa-0000-0000-0000-000000000021","canal":"mostrador",
  "renglones":[{"producto_id":"' || (select id from productos where codigo_interno = 'DEMO-I1') || '","cantidad":1}],
  "pagos":[]}')::jsonb)$$, 'inactivo');

\echo '--- 18. Perfiles solo por alta_perfil'
select pg_temp.espera_error($$update perfiles set rol = 'vendedor' where id = auth.uid()$$, 'permission denied');
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000004', 'vendedor4@prueba.local');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select alta_perfil('00000000-0000-0000-0000-000000000004', 'Vendedor 3 PRUEBA', 'vendedor');
select pg_temp.verifica((select nombre like 'Ruta Vendedor 3 PRUEBA · %' from ubicaciones
                          where vendedor_id = '00000000-0000-0000-0000-000000000004'),
                        'nombre de vendedor repetido recibe una ruta distinta');
select alta_perfil('00000000-0000-0000-0000-000000000004', 'Vendedor 4 PRUEBA', 'bodega');
select pg_temp.verifica((select not activo from ubicaciones where vendedor_id = '00000000-0000-0000-0000-000000000004'),
                        'al dejar de ser vendedor su ruta queda inactiva');

\echo '--- 19. Conteo físico inválido y ajuste vacío'
select crear_jornada('00000000-0000-0000-0000-000000000002') as jornada2 \gset
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select crear_carga(:'jornada2', 'inicial',
  '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":2}]') as carga2 \gset
select despachar_carga(:'carga2') as folio_carga2;
select pg_temp.como('00000000-0000-0000-0000-000000000002');
select confirmar_carga(:'carga2');
select pg_temp.espera_error(format($$select cerrar_ruta('%s', '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":-1}]', 0)$$, :'jornada2'),
                            'Conteo físico inválido');
select pg_temp.espera_error(format($$select cerrar_ruta('%s', '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1},
                                                             {"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1}]', 0)$$, :'jornada2'),
                            'más de una vez');
select pg_temp.espera_error(format($$select cerrar_ruta('%s', '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":2}]', -5)$$, :'jornada2'),
                            'efectivo entregado');
select pg_temp.espera_error($$select registrar_ajuste('merma', (select id from ubicaciones where nombre = 'Ruta V2'), 'x', '[]')$$,
                            'no tiene productos');
\echo '=== PRUEBAS DE CORRECCIONES PASARON ==='
