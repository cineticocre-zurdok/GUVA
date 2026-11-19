-- =====================================================================
-- GUVA · Prueba de flujo MVP (base de datos de PRUEBA, nunca producción)
-- Todos los productos, precios y clientes de aquí son DATOS DE PRUEBA
-- marcados con es_demo = true. No representan el catálogo real.
-- Ejecutar:  psql -v ON_ERROR_STOP=1 -d guva_test -f 01_prueba_flujo_mvp.sql
-- =====================================================================
\set QUIET on
\pset footer off

-- Ayudantes ------------------------------------------------------------
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

create or replace function pg_temp.exist(p_ubic text, p_cod text) returns int language sql as $$
  select coalesce((select e.cantidad from existencias e
                     join ubicaciones u on u.id = e.ubicacion_id
                     join productos p on p.id = e.producto_id
                    where u.nombre = p_ubic and p.codigo_interno = p_cod), 0)
$$;

-- Preparación (como superusuario) --------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@prueba.local'),
  ('00000000-0000-0000-0000-00000000000b', 'bodega@prueba.local'),
  ('00000000-0000-0000-0000-000000000001', 'vendedor1@prueba.local'),
  ('00000000-0000-0000-0000-000000000002', 'vendedor2@prueba.local');
insert into perfiles (id, nombre, rol) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin PRUEBA', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', 'Bodega PRUEBA', 'bodega'),
  ('00000000-0000-0000-0000-000000000001', 'Vendedor 1 PRUEBA', 'vendedor'),
  ('00000000-0000-0000-0000-000000000002', 'Vendedor 2 PRUEBA', 'vendedor');
insert into ubicaciones (nombre, tipo, vendedor_id) values
  ('Ruta V1', 'vendedor', '00000000-0000-0000-0000-000000000001'),
  ('Ruta V2', 'vendedor', '00000000-0000-0000-0000-000000000002');

insert into productos (id, codigo_interno, nombre, marca, linea_id, es_demo) values
  ('11111111-0000-0000-0000-000000000001', 'DEMO-P1', 'Producto prueba 1', 'DEMO', 1, true),
  ('11111111-0000-0000-0000-000000000002', 'DEMO-P2', 'Producto prueba 2', 'DEMO', 2, true);
insert into precios_historial (producto_id, lista, precio, motivo) values
  ('11111111-0000-0000-0000-000000000001', 'costo', 10, 'PRUEBA'),
  ('11111111-0000-0000-0000-000000000001', 'detalle', 15, 'PRUEBA'),
  ('11111111-0000-0000-0000-000000000001', 'mayoreo', 12, 'PRUEBA'),
  ('11111111-0000-0000-0000-000000000002', 'costo', 20, 'PRUEBA'),
  ('11111111-0000-0000-0000-000000000002', 'detalle', 30, 'PRUEBA'),
  ('11111111-0000-0000-0000-000000000002', 'mayoreo', 25, 'PRUEBA');
insert into clientes (id, nombre, tipo, lista_precio, permite_credito, limite_credito, dias_credito, es_demo)
values ('22222222-0000-0000-0000-000000000002', 'Distribuidor 2 PRUEBA', 'distribuidor',
        'mayoreo', true, 900, 7, true);

\echo '--- 1. Bodega registra entrada'
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select registrar_entrada('REMISION-PRUEBA',
  '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":100},
    {"producto_id":"11111111-0000-0000-0000-000000000002","cantidad":50}]') as folio;
select pg_temp.verifica(pg_temp.exist('Bodega principal','DEMO-P1') = 100
                    and pg_temp.exist('Bodega principal','DEMO-P2') = 50, 'bodega 100 / 50');
select pg_temp.espera_error($$select establecer_precio('11111111-0000-0000-0000-000000000001','costo',1)$$,
                            'Permiso denegado');

\echo '--- 2. El vendedor no ve costos'
select pg_temp.como('00000000-0000-0000-0000-000000000001');
select pg_temp.verifica((select count(*) from precios_historial where lista = 'costo') = 0,
                        'vendedor ve 0 renglones de costo');
select pg_temp.verifica((select count(*) from precios_historial) = 4, 'vendedor ve 4 precios de venta');
select pg_temp.espera_error('select costo_unitario from venta_detalle', 'permission denied');
select pg_temp.espera_error('select costo_total from ventas', 'permission denied');
select pg_temp.espera_error($$insert into movimientos_inventario (producto_id,cantidad,tipo,destino_id,usuario_id,referencia_tipo,referencia_id)
  values ('11111111-0000-0000-0000-000000000001',999,'ajuste_entrada',(select id from ubicaciones where nombre='Ruta V1'),auth.uid(),'x',gen_random_uuid())$$,
  'permission denied');

\echo '--- 3. Admin crea jornada; bodega prepara y despacha la carga'
reset role;
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select crear_jornada('00000000-0000-0000-0000-000000000001') as jornada \gset
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select crear_carga(:'jornada', 'inicial',
  '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":30},
    {"producto_id":"11111111-0000-0000-0000-000000000002","cantidad":10}]') as carga \gset
select despachar_carga(:'carga') as folio_carga;
select pg_temp.verifica(pg_temp.exist('Bodega principal','DEMO-P1') = 70
                    and pg_temp.exist('Ruta V1','DEMO-P1') = 30, 'traspaso bodega -> Ruta V1');

\echo '--- 4. Vendedor no vende antes de confirmar; confirma y vende'
select pg_temp.como('00000000-0000-0000-0000-000000000001');
select pg_temp.espera_error(format($$select registrar_venta('{"id":"%s","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1}],
  "pagos":[{"id":"%s","metodo":"efectivo","monto":15}]}')$$, gen_random_uuid(), :'jornada', gen_random_uuid()),
  'jornada de ruta abierta');
select confirmar_carga(:'carga');

select registrar_venta(format('{"id":"aaaaaaaa-0000-0000-0000-000000000001","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":10}],
  "pagos":[{"id":"bbbbbbbb-0000-0000-0000-000000000001","metodo":"efectivo","monto":150}]}', :'jornada')::jsonb) as venta1;

\echo '--- 5. Reenvío de la misma venta (sincronización repetida) no descuenta dos veces'
select registrar_venta(format('{"id":"aaaaaaaa-0000-0000-0000-000000000001","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":10}],
  "pagos":[{"id":"bbbbbbbb-0000-0000-0000-000000000001","metodo":"efectivo","monto":150}]}', :'jornada')::jsonb)->>'duplicada' as duplicada;
select pg_temp.verifica(pg_temp.exist('Ruta V1','DEMO-P1') = 20, 'Ruta V1 P1 = 20 tras venta duplicada');

select registrar_venta(format('{"id":"aaaaaaaa-0000-0000-0000-000000000002","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000002","cantidad":2}],
  "pagos":[{"id":"bbbbbbbb-0000-0000-0000-000000000002","metodo":"transferencia","monto":60,"referencia":"SPEI-PRUEBA"}]}', :'jornada')::jsonb) as venta2;

\echo '--- 6. Rechazos: sin existencia, descuento no autorizado, precio especial, contado incompleto'
select pg_temp.espera_error(format($$select registrar_venta('{"id":"aaaaaaaa-0000-0000-0000-000000000009","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":500}],"pagos":[]}')$$, :'jornada'),
  'Existencia insuficiente');
select pg_temp.verifica(not exists (select 1 from ventas where id = 'aaaaaaaa-0000-0000-0000-000000000009'),
                        'la venta rechazada no dejó rastro');
select pg_temp.espera_error(format($$select registrar_venta('{"id":"%s","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1,"descuento":5}],"pagos":[]}')$$, gen_random_uuid(), :'jornada'),
  'excede el máximo');
select pg_temp.espera_error(format($$select registrar_venta('{"id":"%s","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1,"precio_especial":1}],"pagos":[]}')$$, gen_random_uuid(), :'jornada'),
  'precios especiales');
select pg_temp.espera_error(format($$select registrar_venta('{"id":"%s","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1}],"pagos":[{"id":"%s","metodo":"efectivo","monto":10}]}')$$,
  gen_random_uuid(), :'jornada', gen_random_uuid()), 'deben igualar el total');

\echo '--- 7. Gasto de ruta, devolución y merma'
select registrar_gasto('{"id":"cccccccc-0000-0000-0000-000000000001","categoria":"combustible",
  "concepto":"Gasolina PRUEBA","monto":100,"metodo":"efectivo"}') as gasto;
select registrar_ajuste('devolucion_bodega', (select id from ubicaciones where nombre = 'Ruta V1'),
  'Sobrante PRUEBA', '[{"producto_id":"11111111-0000-0000-0000-000000000002","cantidad":3}]') as devolucion;
select registrar_ajuste('merma', (select id from ubicaciones where nombre = 'Ruta V1'),
  'Empaque dañado PRUEBA', '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1}]') as merma;
select pg_temp.espera_error($$select registrar_ajuste('ajuste_entrada', (select id from ubicaciones where nombre = 'Ruta V1'),
  'x', '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":50}]')$$, 'Solo el administrador');

\echo '--- 8. Aislamiento entre vendedores'
select pg_temp.como('00000000-0000-0000-0000-000000000002');
select pg_temp.verifica((select count(*) from ventas) = 0, 'vendedor 2 no ve ventas del vendedor 1');
select pg_temp.verifica((select count(*) from jornadas_ruta) = 0, 'vendedor 2 no ve la jornada del vendedor 1');
select pg_temp.espera_error(format($$select registrar_venta('{"id":"%s","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1}],"pagos":[{"id":"%s","metodo":"efectivo","monto":15}]}')$$,
  gen_random_uuid(), :'jornada', gen_random_uuid()), 'otro vendedor');

\echo '--- 9. Mayoreo a crédito con límite y abono'
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select registrar_venta('{"id":"aaaaaaaa-0000-0000-0000-000000000010","canal":"mayoreo",
  "cliente_id":"22222222-0000-0000-0000-000000000002","condicion":"credito",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000002","cantidad":10}],"pagos":[]}') as mayoreo;
select pg_temp.verifica((select total from ventas where id = 'aaaaaaaa-0000-0000-0000-000000000010') = 250,
                        'mayoreo usa precio preferencial (10 x 25 = 250)');
select pg_temp.verifica((select fecha_vencimiento - (registrada_en at time zone 'America/Mexico_City')::date from ventas
                          where id = 'aaaaaaaa-0000-0000-0000-000000000010') = 7, 'vence a 7 días');
select pg_temp.espera_error($$select registrar_venta('{"id":"aaaaaaaa-0000-0000-0000-000000000011","canal":"mayoreo",
  "cliente_id":"22222222-0000-0000-0000-000000000002","condicion":"credito",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000002","cantidad":30}],"pagos":[]}')$$, 'Límite de crédito');
select registrar_pago('{"id":"bbbbbbbb-0000-0000-0000-000000000010","venta_id":"aaaaaaaa-0000-0000-0000-000000000010",
  "metodo":"transferencia","monto":100}')->>'saldo' as saldo_tras_abono;
select pg_temp.espera_error($$select registrar_pago('{"id":"bbbbbbbb-0000-0000-0000-000000000011","venta_id":"aaaaaaaa-0000-0000-0000-000000000010",
  "metodo":"efectivo","monto":151}')$$, 'saldo pendiente es 150');

\echo '--- 10. Cierre de ruta con faltante de mercancía y de efectivo'
select pg_temp.como('00000000-0000-0000-0000-000000000001');
select pg_temp.espera_error(format($$select cerrar_ruta('%s', '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":18}]', 40)$$, :'jornada'),
                            'Falta el conteo');
select cerrar_ruta(:'jornada',
  '[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":18},
    {"producto_id":"11111111-0000-0000-0000-000000000002","cantidad":5}]', 40) as cierre \gset
\echo :cierre
select p.codigo_interno, d.inicial, d.adicional, d.vendido, d.devuelto, d.merma,
       d.final_teorico, d.final_contado, d.diferencia
  from cierre_detalle d join productos p on p.id = d.producto_id order by 1;
select pg_temp.verifica((select efectivo_esperado = 50 and diferencia_efectivo = -10 and cobrado_transferencia = 60
                           from cierres_ruta), 'efectivo: 150 cobrado - 100 gasto = 50 esperado; entregó 40 => -10');
select pg_temp.espera_error(format($$select registrar_venta('{"id":"%s","canal":"ruta","jornada_id":"%s",
  "renglones":[{"producto_id":"11111111-0000-0000-0000-000000000001","cantidad":1}],"pagos":[{"id":"%s","metodo":"efectivo","monto":15}]}')$$,
  gen_random_uuid(), :'jornada', gen_random_uuid()), 'jornada de ruta abierta');

\echo '--- 11. Admin revisa el cierre: la diferencia queda como ajuste trazable'
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select revisar_cierre((:'cierre'::jsonb->>'cierre_id')::uuid, 'Revisado PRUEBA');
select pg_temp.verifica(pg_temp.exist('Ruta V1','DEMO-P1') = 18, 'Ruta V1 P1 = 18 = conteo físico');
select pg_temp.verifica(pg_temp.exist('Bodega principal','DEMO-P2') = 33, 'Bodega P2 = 50 - 10 - 10 + 3 = 33');

\echo '--- 12. Inmutabilidad y cancelación compensatoria'
reset role;
select pg_temp.espera_error($$delete from ventas where id = 'aaaaaaaa-0000-0000-0000-000000000010'$$, 'no permitida');
select pg_temp.espera_error($$update movimientos_inventario set cantidad = 1$$, 'no permitida');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select cancelar_venta('aaaaaaaa-0000-0000-0000-000000000010', 'Error de captura PRUEBA');
select pg_temp.verifica(pg_temp.exist('Bodega principal','DEMO-P2') = 43, 'cancelación regresa 10 piezas a bodega');
select pg_temp.verifica((select count(*) from pagos where venta_id = 'aaaaaaaa-0000-0000-0000-000000000010'
                          and estado = 'cancelada') = 1, 'el abono quedó cancelado, no borrado');

\echo '--- 13. Resumen diario (admin)'
select venta_neta, venta_ruta, venta_mayoreo, costo_vendido, margen_bruto, cobrado, gastos,
       resultado_operativo_estimado from v_resumen_diario;
select pg_temp.verifica((select venta_neta = 210 and costo_vendido = 140 and margen_bruto = 70
                                and cobrado = 210 and gastos = 100 from v_resumen_diario),
                        'venta 210 - costo 140 = margen 70; gastos 100');
select pg_temp.verifica((select sum(margen_bruto) from v_rentabilidad) = 70, 'rentabilidad por renglón suma margen 70');
select pg_temp.verifica((select sum(valor) from v_inventario_valorizado) > 0, 'inventario valorizado visible para admin');
select pg_temp.como('00000000-0000-0000-0000-000000000001');
select pg_temp.verifica((select count(*) from v_resumen_diario) = 0
                    and (select count(*) from v_rentabilidad) = 0, 'vendedor no ve vistas financieras');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.verifica((select count(*) from auditoria) > 20, 'auditoría con eventos registrados');
\echo '=== TODAS LAS PRUEBAS PASARON ==='
