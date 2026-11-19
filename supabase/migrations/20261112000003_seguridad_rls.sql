-- =====================================================================
-- GUVA · Migración 0003 · Permisos y Row Level Security
-- Principio: lectura por RLS; escritura operativa solo por funciones RPC.
-- =====================================================================

-- 1. Cerrar todo lo que Supabase concede por defecto
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;

-- 2. Activar RLS en todas las tablas
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- 3. Lectura (SELECT) por tabla
grant select on configuracion, lineas, productos, ubicaciones, clientes, folios to authenticated;
grant select on perfiles, existencias, jornadas_ruta, jornada_saldo_inicial, cargas,
                carga_detalle, ventas, pagos, gastos, entradas, ajustes,
                cierres_ruta, cierre_detalle, precios_historial to authenticated;
grant select on auditoria to authenticated;

-- Columnas de costo: el vendedor no las ve (privilegio por columna)
grant select (venta_id, renglon, producto_id, cantidad, lista_aplicada,
              precio_unitario, descuento, importe) on venta_detalle to authenticated;
grant select (id, creado_en, producto_id, cantidad, tipo, origen_id, destino_id, usuario_id,
              motivo, referencia_tipo, referencia_id, jornada_id)
      on movimientos_inventario to authenticated;
-- El costo total de la venta también es dato reservado
revoke select on ventas from authenticated;
grant select (id, folio, canal, cliente_id, vendedor_id, jornada_id, ubicacion_id, condicion,
              fecha_vencimiento, subtotal, descuento, total, estado, notas, registrada_en,
              sincronizada_en, dispositivo_id, cancelada_en, motivo_cancelacion)
      on ventas to authenticated;

-- Catálogo visible para todos los usuarios activos
create policy lectura on configuracion for select to authenticated using (rol_actual() is not null);
create policy lectura on lineas        for select to authenticated using (rol_actual() is not null);
create policy lectura on productos     for select to authenticated using (rol_actual() is not null);
create policy lectura on ubicaciones   for select to authenticated using (rol_actual() is not null);
create policy lectura on clientes      for select to authenticated using (rol_actual() is not null);
create policy lectura on folios        for select to authenticated using (rol_actual() = 'admin');

-- Precios: el costo de compra solo lo ve el administrador
create policy lectura on precios_historial for select to authenticated
  using (rol_actual() = 'admin'
         or (rol_actual() in ('vendedor', 'bodega') and lista <> 'costo'));

-- Perfiles: cada quien el suyo; admin todos
create policy lectura on perfiles for select to authenticated
  using (id = auth.uid() or rol_actual() = 'admin');

-- Existencias: admin y bodega todo; vendedor su ubicación y la bodega
create policy lectura on existencias for select to authenticated
  using (rol_actual() in ('admin', 'bodega')
         or ubicacion_id in (select id from ubicaciones
                              where vendedor_id = auth.uid() or tipo = 'bodega'));

create policy lectura on movimientos_inventario for select to authenticated
  using (rol_actual() in ('admin', 'bodega')
         or origen_id  in (select id from ubicaciones where vendedor_id = auth.uid())
         or destino_id in (select id from ubicaciones where vendedor_id = auth.uid()));

-- Ruta: el vendedor ve lo suyo
create policy lectura on jornadas_ruta for select to authenticated
  using (rol_actual() in ('admin', 'bodega') or vendedor_id = auth.uid());
create policy lectura on jornada_saldo_inicial for select to authenticated
  using (jornada_id in (select id from jornadas_ruta));          -- hereda RLS de jornadas
create policy lectura on cargas for select to authenticated
  using (jornada_id in (select id from jornadas_ruta));
create policy lectura on carga_detalle for select to authenticated
  using (carga_id in (select id from cargas));

-- Ventas, cobros, gastos y cierres: admin todo; vendedor lo suyo
create policy lectura on ventas for select to authenticated
  using (rol_actual() = 'admin' or vendedor_id = auth.uid());
create policy lectura on venta_detalle for select to authenticated
  using (venta_id in (select id from ventas));
create policy lectura on pagos for select to authenticated
  using (rol_actual() = 'admin' or recibido_por = auth.uid());
create policy lectura on gastos for select to authenticated
  using (rol_actual() = 'admin' or usuario_id = auth.uid());
create policy lectura on cierres_ruta for select to authenticated
  using (jornada_id in (select id from jornadas_ruta));
create policy lectura on cierre_detalle for select to authenticated
  using (cierre_id in (select id from cierres_ruta));

-- Documentos de bodega
create policy lectura on entradas for select to authenticated
  using (rol_actual() in ('admin', 'bodega'));
create policy lectura on ajustes for select to authenticated
  using (rol_actual() in ('admin', 'bodega') or autorizado_por = auth.uid());

create policy lectura on auditoria for select to authenticated using (rol_actual() = 'admin');

-- 4. Escritura directa: solo catálogo y configuración, solo administrador
grant insert, update on productos, clientes, lineas, ubicaciones, configuracion, perfiles
  to authenticated;
create policy admin_escribe on productos     for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy admin_escribe on clientes      for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy admin_escribe on lineas        for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy admin_escribe on ubicaciones   for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy admin_escribe on configuracion for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');
create policy admin_escribe on perfiles      for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- 5. Vistas
grant select on v_precios_vigentes, v_saldos_ventas, v_existencias to authenticated;
-- Vistas financieras: devuelven filas solo al administrador (filtro rol_actual() interno)
grant select on v_resumen_diario, v_rentabilidad, v_inventario_valorizado to authenticated;

-- 6. Funciones RPC expuestas (cada una valida el rol internamente)
grant execute on function
  hoy(),
  rol_actual(),
  establecer_precio(uuid, lista_precio, numeric, text),
  registrar_entrada(text, jsonb, text),
  crear_jornada(uuid, date),
  crear_carga(uuid, tipo_carga, jsonb, text),
  despachar_carga(uuid),
  confirmar_carga(uuid),
  registrar_venta(jsonb),
  registrar_pago(jsonb),
  registrar_gasto(jsonb),
  registrar_ajuste(tipo_movimiento, uuid, text, jsonb),
  cancelar_venta(uuid, text),
  cancelar_gasto(uuid, text),
  cancelar_pago(uuid, text),
  cerrar_ruta(uuid, jsonb, numeric, text),
  revisar_cierre(uuid, text)
to authenticated;

-- 7. Storage: bucket privado para comprobantes de gastos y depósitos
--    (se crea en supabase/config o desde el panel; ver README)
