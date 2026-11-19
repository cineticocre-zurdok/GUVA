-- =====================================================================
-- GUVA · Prueba de ventas offline (base de datos de PRUEBA, nunca producción)
-- Datos marcados es_demo = true / "PRUEBA". Requiere haber corrido 01..03.
-- =====================================================================
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

-- Preparación --------------------------------------------------------------
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000005', 'vendedor5@prueba.local');
insert into productos (id, codigo_interno, nombre, marca, linea_id, es_demo) values
  ('11111111-0000-0000-0000-000000000005', 'DEMO-P5', 'Producto prueba 5', 'DEMO', 1, true);
insert into precios_historial (producto_id, lista, precio, motivo) values
  ('11111111-0000-0000-0000-000000000005', 'costo', 8, 'PRUEBA'),
  ('11111111-0000-0000-0000-000000000005', 'detalle', 12, 'PRUEBA');

select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select alta_perfil('00000000-0000-0000-0000-000000000005', 'Vendedor 5 PRUEBA', 'vendedor');
select registrar_entrada('REMISION-PRUEBA-5', '[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":40}]');
select crear_jornada('00000000-0000-0000-0000-000000000005') as jornada \gset
select crear_carga(:'jornada', 'inicial', '[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":20}]') as carga \gset
select despachar_carga(:'carga');

select pg_temp.como('00000000-0000-0000-0000-000000000005');
select confirmar_carga(:'carga');

\echo '--- 1. Venta offline de contado: el servidor liquida por el total'
select registrar_venta_offline(format('{"id":"cccccccc-0000-0000-0000-000000000001","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":3}],
  "liquidar":{"id":"dddddddd-0000-0000-0000-000000000001","metodo":"efectivo"}}', :'jornada')::jsonb);
select pg_temp.verifica((select total from ventas where id = 'cccccccc-0000-0000-0000-000000000001') = 36
                    and (select monto from pagos where id = 'dddddddd-0000-0000-0000-000000000001') = 36,
                    'venta 3 x 12 = 36 cobrada por 36');

\echo '--- 2. El precio cambió antes de sincronizar: se cobra el precio vigente del servidor'
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select establecer_precio('11111111-0000-0000-0000-000000000005', 'detalle', 13, 'PRUEBA cambio');
select pg_temp.como('00000000-0000-0000-0000-000000000005');
select registrar_venta_offline(format('{"id":"cccccccc-0000-0000-0000-000000000002","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":2}],
  "liquidar":{"id":"dddddddd-0000-0000-0000-000000000002","metodo":"transferencia","referencia":"SPEI PRUEBA"}}', :'jornada')::jsonb);
select pg_temp.verifica((select total from ventas where id = 'cccccccc-0000-0000-0000-000000000002') = 26
                    and (select monto from pagos where id = 'dddddddd-0000-0000-0000-000000000002') = 26,
                    'venta liquidada a 13 (precio nuevo), no a 12');

\echo '--- 3. Reenvío: no duplica venta, cobro ni inventario'
select registrar_venta_offline(format('{"id":"cccccccc-0000-0000-0000-000000000002","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":2}],
  "liquidar":{"id":"dddddddd-0000-0000-0000-000000000099","metodo":"transferencia"}}', :'jornada')::jsonb)->>'duplicada' as duplicada \gset
select pg_temp.verifica(:'duplicada' = 'true', 'reenvío marcado como duplicado');
select pg_temp.verifica((select count(*) from pagos where venta_id = 'cccccccc-0000-0000-0000-000000000002') = 1, 'un solo cobro');
select pg_temp.verifica((select cantidad from existencias e join ubicaciones u on u.id = e.ubicacion_id
                          where u.vendedor_id = '00000000-0000-0000-0000-000000000005'
                            and e.producto_id = '11111111-0000-0000-0000-000000000005') = 15,
                        'ruta 20 - 3 - 2 = 15');

\echo '--- 4. Combinaciones inválidas'
select pg_temp.espera_error(format($$select registrar_venta_offline('{"id":"%s","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":1}],
  "pagos":[{"id":"%s","metodo":"efectivo","monto":13}],
  "liquidar":{"id":"%s","metodo":"efectivo"}}')$$, gen_random_uuid(), :'jornada', gen_random_uuid(), gen_random_uuid()),
  'use solo uno');
select pg_temp.espera_error(format($$select registrar_venta_offline('{"id":"%s","canal":"ruta","jornada_id":"%s","condicion":"credito",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":1}],
  "liquidar":{"id":"%s","metodo":"efectivo"}}')$$, gen_random_uuid(), :'jornada', gen_random_uuid()),
  'Solo una venta de contado');
select pg_temp.espera_error(format($$select registrar_venta_offline('{"id":"%s","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":99}],
  "liquidar":{"id":"%s","metodo":"efectivo"}}')$$, gen_random_uuid(), :'jornada', gen_random_uuid()),
  'Existencia insuficiente');

\echo '--- 5. Gasto y cierre: efectivo esperado = cobrado en efectivo - gastos en efectivo'
select registrar_gasto('{"id":"eeeeeeee-0000-0000-0000-000000000001","categoria":"combustible","concepto":"Gasolina PRUEBA","monto":10,"metodo":"efectivo"}');
select (cerrar_ruta(:'jornada', '[{"producto_id":"11111111-0000-0000-0000-000000000005","cantidad":15}]', 26)->>'efectivo_esperado')::numeric as esperado \gset
select pg_temp.verifica(:'esperado' = 26, 'esperado 36 - 10 = 26');

\echo '=== PRUEBAS DE VENTAS OFFLINE PASARON ==='
