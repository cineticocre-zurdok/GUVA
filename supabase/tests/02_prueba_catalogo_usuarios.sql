-- GUVA · Prueba de importación de catálogo y alta de usuarios (base de PRUEBA)
-- Ejecutar después de 01_prueba_flujo_mvp.sql (reutiliza sus usuarios de prueba).
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

\echo '--- 14. Importación de catálogo'
select pg_temp.como('00000000-0000-0000-0000-00000000000b');
select pg_temp.espera_error($$select importar_productos('[{"codigo_interno":"X","nombre":"X","marca":"X","linea":"Kinder"}]')$$,
                            'Permiso denegado');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select importar_productos('[
  {"codigo_interno":"DEMO-I1","codigo_barras":"0000000000011","nombre":"Importado 1 PRUEBA","marca":"DEMO","linea":"kinder","piezas_por_empaque":"12","costo":"8.5","precio_detalle":"12","precio_mayoreo":"10"},
  {"codigo_interno":"DEMO-P1","nombre":"Producto prueba 1 renombrado","marca":"DEMO","linea":"Ferrero","costo":"10","precio_detalle":"16"}
]') as resultado;
select pg_temp.verifica((select nombre from productos where codigo_interno = 'DEMO-P1') = 'Producto prueba 1 renombrado',
                        'actualiza por código interno');
select pg_temp.verifica((select precio from v_precios_vigentes v join productos p on p.id = v.producto_id
                          where p.codigo_interno = 'DEMO-P1' and lista = 'detalle') = 16, 'precio detalle nuevo vigente');
select pg_temp.verifica((select count(*) from precios_historial h join productos p on p.id = h.producto_id
                          where p.codigo_interno = 'DEMO-P1' and lista = 'costo') = 1,
                        'costo igual al vigente no duplica historial');
select pg_temp.espera_error($$select importar_productos('[{"codigo_interno":"DEMO-I2","nombre":"A","marca":"B","linea":"Chocolates"}]')$$,
                            'no existe');
select pg_temp.espera_error($$select importar_productos('[{"codigo_interno":"DEMO-I3","nombre":"A","marca":"B","linea":"Kinder"},
                                                          {"codigo_interno":"DEMO-I4","nombre":"A","marca":"B","linea":"Kinder","costo":"abc"}]')$$,
                            'Fila 2');
select pg_temp.verifica(not exists (select 1 from productos where codigo_interno = 'DEMO-I3'),
                        'importación con error no deja filas a medias');

\echo '--- 15. Alta de perfiles'
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000003', 'vendedor3@prueba.local');
select pg_temp.como('00000000-0000-0000-0000-00000000000a');
select pg_temp.verifica((select count(*) from usuarios_sin_perfil()) = 1, 'un usuario sin perfil');
select alta_perfil('00000000-0000-0000-0000-000000000003', 'Vendedor 3 PRUEBA', 'vendedor');
select pg_temp.verifica(exists (select 1 from ubicaciones where vendedor_id = '00000000-0000-0000-0000-000000000003'),
                        'vendedor nuevo recibe su ubicación de ruta');
select pg_temp.espera_error($$select alta_perfil('00000000-0000-0000-0000-00000000000a','Admin','vendedor')$$,
                            'a sí mismo');
select pg_temp.como('00000000-0000-0000-0000-000000000001');
select pg_temp.espera_error($$select * from usuarios_sin_perfil()$$, 'Permiso denegado');
\echo '=== PRUEBAS DE CATÁLOGO Y USUARIOS PASARON ==='
