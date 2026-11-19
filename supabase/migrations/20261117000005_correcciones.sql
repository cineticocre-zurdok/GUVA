-- =====================================================================
-- GUVA · Migración 0005 · Correcciones de la revisión de la Entrega 1
-- - Permisos por defecto cerrados para objetos futuros
-- - Perfiles solo se modifican con alta_perfil (no por escritura directa)
-- - Cancelaciones no alteran cierres de ruta ya hechos
-- - Validación del conteo físico en cerrar_ruta
-- - No se vende ni se carga un producto inactivo
-- - alta_perfil: cambio de rol de vendedor y nombres de ruta repetidos
-- - Mensajes claros en importar_productos y registrar_ajuste
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permisos por defecto: Supabase concede todo a anon/authenticated en
--    cada objeto nuevo de "public". La 0003 solo cerró lo que ya existía.
--    Desde aquí, toda tabla o función nueva requiere un GRANT explícito
--    (incluidas las funciones que se usen dentro de políticas RLS).
-- ---------------------------------------------------------------------
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- Funciones de la 0004 que quedaron con permiso para anon
revoke execute on function
  importar_productos(jsonb, text),
  usuarios_sin_perfil(),
  alta_perfil(uuid, text, rol_usuario, boolean)
from anon, public;

-- ---------------------------------------------------------------------
-- 2. Perfiles: solo por alta_perfil (que impide que el administrador se
--    quite a sí mismo el rol). El primer admin se inserta desde el SQL
--    Editor, que corre como postgres y no se ve afectado.
-- ---------------------------------------------------------------------
drop policy if exists admin_escribe on perfiles;
revoke insert, update on perfiles from authenticated;

-- ---------------------------------------------------------------------
-- 3. Cancelaciones
-- ---------------------------------------------------------------------
create or replace function jornada_cerrada(p_jornada uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select estado in ('en_cierre', 'cerrada') from jornadas_ruta where id = p_jornada), false)
$$;

create or replace function cancelar_venta(p_venta uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin'); v ventas%rowtype; d record;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  select * into v from ventas where id = p_venta for update;
  if v.id is null or v.estado <> 'cerrada' then raise exception 'La venta no está vigente'; end if;
  if jornada_cerrada(v.jornada_id) then
    raise exception 'La jornada ya fue cerrada; registre una devolución de cliente';
  end if;
  -- Un abono cobrado en otra jornada que ya se cerró también forma parte de ese cierre
  if exists (select 1 from pagos where venta_id = p_venta and estado = 'cerrada'
                                   and jornada_cerrada(jornada_id)) then
    raise exception 'La venta tiene cobros que ya forman parte de un cierre de ruta; registre una devolución de cliente';
  end if;
  for d in select * from venta_detalle where venta_id = p_venta loop
    insert into movimientos_inventario
      (producto_id, cantidad, tipo, destino_id, usuario_id, motivo,
       referencia_tipo, referencia_id, costo_unitario, jornada_id)
    values (d.producto_id, d.cantidad, 'cancelacion_venta', v.ubicacion_id, v_uid, p_motivo,
            'venta', p_venta, d.costo_unitario, v.jornada_id);
  end loop;
  update pagos set estado = 'cancelada', cancelado_en = now(), cancelado_por = v_uid,
                   motivo_cancelacion = 'Venta cancelada: ' || p_motivo
   where venta_id = p_venta and estado = 'cerrada';
  update ventas set estado = 'cancelada', cancelada_en = now(), cancelada_por = v_uid,
                    motivo_cancelacion = p_motivo
   where id = p_venta;
end $$;

create or replace function cancelar_gasto(p_gasto uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin'); g gastos%rowtype;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  select * into g from gastos where id = p_gasto for update;
  if g.id is null or g.estado <> 'cerrada' then raise exception 'Gasto inexistente o ya cancelado'; end if;
  if jornada_cerrada(g.jornada_id) then
    raise exception 'El gasto ya forma parte de un cierre de ruta y no puede cancelarse';
  end if;
  update gastos set estado = 'cancelada', cancelado_en = now(), cancelado_por = v_uid,
                    motivo_cancelacion = p_motivo
   where id = p_gasto;
end $$;

create or replace function cancelar_pago(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin'); pg pagos%rowtype; v_cond condicion_pago;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  select * into pg from pagos where id = p_pago for update;
  if pg.id is null or pg.estado <> 'cerrada' then raise exception 'Cobro inexistente o ya cancelado'; end if;
  if jornada_cerrada(pg.jornada_id) then
    raise exception 'El cobro ya forma parte de un cierre de ruta y no puede cancelarse';
  end if;
  select condicion into v_cond from ventas where id = pg.venta_id;
  if v_cond = 'contado' then
    raise exception 'El cobro pertenece a una venta de contado; cancele la venta completa';
  end if;
  update pagos set estado = 'cancelada', cancelado_en = now(), cancelado_por = v_uid,
                   motivo_cancelacion = p_motivo
   where id = p_pago;
end $$;

-- ---------------------------------------------------------------------
-- 4. Cierre de ruta: conteo físico y efectivo válidos
-- ---------------------------------------------------------------------
create or replace function cerrar_ruta(p_jornada uuid, p_conteo jsonb,
                                       p_efectivo_entregado numeric,
                                       p_observaciones text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := exigir_rol('vendedor', 'admin');
  j jornadas_ruta%rowtype; v_id uuid; v_folio text;
  v_ventas numeric; v_credito numeric; v_efe numeric; v_trf numeric; v_gas numeric;
  v_esperado numeric; v_piezas int; v_faltan text;
begin
  if jsonb_typeof(p_conteo) is distinct from 'array' then
    raise exception 'El conteo físico debe ser una lista de productos';
  end if;
  if exists (select 1 from jsonb_array_elements(p_conteo) x
              where x->>'producto_id' is null
                 or not coalesce(x->>'cantidad' ~ '^\d{1,9}$', false)) then
    raise exception 'Conteo físico inválido: cada producto requiere una cantidad entera de 0 o más';
  end if;
  if (select count(*) <> count(distinct x->>'producto_id') from jsonb_array_elements(p_conteo) x) then
    raise exception 'Conteo físico inválido: un producto aparece más de una vez';
  end if;
  if p_efectivo_entregado is null or p_efectivo_entregado < 0 then
    raise exception 'El efectivo entregado debe ser 0 o más';
  end if;

  select * into j from jornadas_ruta where id = p_jornada for update;
  if j.id is null or j.estado <> 'abierta' then raise exception 'La jornada no está abierta'; end if;
  if rol_actual() = 'vendedor' and j.vendedor_id <> v_uid then
    raise exception 'La jornada pertenece a otro vendedor' using errcode = '42501';
  end if;
  if exists (select 1 from cargas where jornada_id = p_jornada and estado in ('preparando','por_confirmar')) then
    raise exception 'Hay cargas sin confirmar en la jornada';
  end if;

  -- Toda mercancía con existencia teórica debe contarse
  select string_agg(pr.nombre, ', ') into v_faltan
    from calcular_cierre(p_jornada) c join productos pr on pr.id = c.producto_id
   where c.final_teorico <> 0
     and not exists (select 1 from jsonb_array_elements(p_conteo) x
                      where (x->>'producto_id')::uuid = c.producto_id);
  if v_faltan is not null then raise exception 'Falta el conteo físico de: %', v_faltan; end if;

  select coalesce(sum(total), 0), coalesce(sum(total) filter (where condicion = 'credito'), 0)
    into v_ventas, v_credito from ventas where jornada_id = p_jornada and estado = 'cerrada';
  select coalesce(sum(monto) filter (where metodo = 'efectivo'), 0),
         coalesce(sum(monto) filter (where metodo = 'transferencia'), 0)
    into v_efe, v_trf from pagos where jornada_id = p_jornada and estado = 'cerrada';
  select coalesce(sum(monto), 0) into v_gas
    from gastos where jornada_id = p_jornada and estado = 'cerrada' and metodo = 'efectivo';
  v_esperado := v_efe - v_gas;

  v_folio := siguiente_folio('CR');
  insert into cierres_ruta (folio, jornada_id, ventas_total, ventas_credito, cobrado_efectivo,
                            cobrado_transferencia, gastos_efectivo, efectivo_esperado,
                            efectivo_entregado, diferencia_efectivo, piezas_diferencia,
                            cerrado_por, observaciones)
  values (v_folio, p_jornada, v_ventas, v_credito, v_efe, v_trf, v_gas, v_esperado,
          round(p_efectivo_entregado, 2), round(p_efectivo_entregado, 2) - v_esperado, 0,
          v_uid, p_observaciones)
  returning id into v_id;

  insert into cierre_detalle (cierre_id, producto_id, inicial, adicional, vendido, devuelto,
                              merma, final_teorico, final_contado, diferencia)
  select v_id, c.producto_id, c.inicial, c.adicional, c.vendido, c.devuelto, c.merma,
         c.final_teorico, coalesce(x.cantidad, 0), coalesce(x.cantidad, 0) - c.final_teorico
    from calcular_cierre(p_jornada) c
    left join (select (e->>'producto_id')::uuid as producto_id, (e->>'cantidad')::int as cantidad
                 from jsonb_array_elements(p_conteo) e) x on x.producto_id = c.producto_id;

  select coalesce(sum(abs(diferencia)), 0) into v_piezas from cierre_detalle where cierre_id = v_id;
  update cierres_ruta set piezas_diferencia = v_piezas where id = v_id;
  update jornadas_ruta set estado = 'en_cierre' where id = p_jornada;

  return jsonb_build_object('cierre_id', v_id, 'folio', v_folio,
                            'efectivo_esperado', v_esperado,
                            'diferencia_efectivo', round(p_efectivo_entregado, 2) - v_esperado,
                            'piezas_diferencia', v_piezas);
end $$;

-- ---------------------------------------------------------------------
-- 5. Productos inactivos no se venden ni se cargan a ruta
-- ---------------------------------------------------------------------
create or replace function exigir_producto_activo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_nombre text; v_activo boolean;
begin
  select nombre, activo into v_nombre, v_activo from productos where id = new.producto_id;
  if v_nombre is null then raise exception 'Producto inexistente'; end if;
  if not v_activo then raise exception 'El producto "%" está inactivo', v_nombre; end if;
  return new;
end $$;

create trigger trg_producto_activo before insert on venta_detalle
  for each row execute function exigir_producto_activo();
create trigger trg_producto_activo before insert on carga_detalle
  for each row execute function exigir_producto_activo();

-- ---------------------------------------------------------------------
-- 6. Alta y cambio de perfiles
-- ---------------------------------------------------------------------
create or replace function alta_perfil(p_usuario uuid, p_nombre text, p_rol rol_usuario,
                                       p_activo boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin'); v_rol_previo rol_usuario; v_ruta text;
begin
  if coalesce(trim(p_nombre), '') = '' then raise exception 'El nombre es obligatorio'; end if;
  if p_usuario = v_uid and (p_rol <> 'admin' or not p_activo) then
    raise exception 'No puede quitarse a sí mismo el rol de administrador';
  end if;

  select rol into v_rol_previo from perfiles where id = p_usuario;
  if v_rol_previo = 'vendedor' and (p_rol <> 'vendedor' or not p_activo)
     and exists (select 1 from jornadas_ruta where vendedor_id = p_usuario
                                              and estado in ('preparacion', 'abierta', 'en_cierre')) then
    raise exception 'El vendedor tiene una jornada de ruta sin cerrar; ciérrela antes de cambiar su rol o desactivarlo';
  end if;

  insert into perfiles (id, nombre, rol, activo) values (p_usuario, trim(p_nombre), p_rol, p_activo)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

  if p_rol = 'vendedor' then
    -- Dos vendedores con el mismo nombre: se distingue la ruta con parte del id
    v_ruta := 'Ruta ' || trim(p_nombre);
    if exists (select 1 from ubicaciones where nombre = v_ruta and vendedor_id is distinct from p_usuario) then
      v_ruta := v_ruta || ' · ' || left(p_usuario::text, 8);
    end if;
    insert into ubicaciones (nombre, tipo, vendedor_id) values (v_ruta, 'vendedor', p_usuario)
    on conflict (vendedor_id) do update set activo = p_activo;
  else
    -- Deja de ser vendedor: su inventario de ruta ya no admite jornadas
    update ubicaciones set activo = false where vendedor_id = p_usuario and activo;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. importar_productos: error de restricción con número de fila
-- ---------------------------------------------------------------------
create or replace function importar_productos(p_filas jsonb, p_motivo text default 'Importación de catálogo')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := exigir_rol('admin');
  r jsonb; v_n int := 0; v_linea smallint; v_id uuid; v_nuevo boolean;
  v_creados int := 0; v_actualizados int := 0; v_precios int := 0;
  v_lista lista_precio; v_campo text; v_valor numeric;
begin
  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no contiene filas';
  end if;
  if jsonb_array_length(p_filas) > 2000 then
    raise exception 'Máximo 2000 filas por importación';
  end if;

  for r in select * from jsonb_array_elements(p_filas) loop
    v_n := v_n + 1;
    if coalesce(trim(r->>'codigo_interno'), '') = '' then
      raise exception 'Fila %: falta codigo_interno', v_n;
    end if;
    if coalesce(trim(r->>'nombre'), '') = '' or coalesce(trim(r->>'marca'), '') = '' then
      raise exception 'Fila % (%): nombre y marca son obligatorios', v_n, r->>'codigo_interno';
    end if;
    select id into v_linea from lineas where lower(nombre) = lower(trim(r->>'linea')) and activo;
    if v_linea is null then
      raise exception 'Fila % (%): línea "%" no existe. Líneas válidas: %', v_n, r->>'codigo_interno',
        r->>'linea', (select string_agg(nombre, ', ' order by id) from lineas where activo);
    end if;

    insert into productos (codigo_interno, codigo_barras, nombre, marca, linea_id, presentacion,
                           unidad_medida, piezas_por_empaque, stock_minimo)
    values (trim(r->>'codigo_interno'), nullif(trim(r->>'codigo_barras'), ''), trim(r->>'nombre'),
            trim(r->>'marca'), v_linea, nullif(trim(r->>'presentacion'), ''),
            coalesce(nullif(trim(r->>'unidad_medida'), ''), 'pieza'),
            coalesce(nullif(r->>'piezas_por_empaque', '')::int, 1),
            coalesce(nullif(r->>'stock_minimo', '')::int, 0))
    on conflict (codigo_interno) do update set
      codigo_barras      = coalesce(excluded.codigo_barras, productos.codigo_barras),
      nombre             = excluded.nombre,
      marca              = excluded.marca,
      linea_id           = excluded.linea_id,
      presentacion       = coalesce(excluded.presentacion, productos.presentacion),
      unidad_medida      = excluded.unidad_medida,
      piezas_por_empaque = excluded.piezas_por_empaque,
      stock_minimo       = excluded.stock_minimo
    returning id, (xmax = 0) into v_id, v_nuevo;
    if v_nuevo then v_creados := v_creados + 1; else v_actualizados := v_actualizados + 1; end if;

    foreach v_campo in array array['costo', 'precio_detalle', 'precio_mayoreo'] loop
      continue when coalesce(trim(r->>v_campo), '') = '';
      v_valor := round((r->>v_campo)::numeric, 2);
      if v_valor < 0 then raise exception 'Fila %: % negativo', v_n, v_campo; end if;
      v_lista := case v_campo when 'costo' then 'costo' when 'precio_detalle' then 'detalle'
                              else 'mayoreo' end;
      if precio_vigente(v_id, v_lista) is distinct from v_valor then
        insert into precios_historial (producto_id, lista, precio, registrado_por, motivo)
        values (v_id, v_lista, v_valor, v_uid, p_motivo);
        v_precios := v_precios + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('filas', v_n, 'creados', v_creados,
                            'actualizados', v_actualizados, 'precios_registrados', v_precios);
exception
  when unique_violation then
    raise exception 'Fila %: código de barras repetido con otro producto', v_n;
  when invalid_text_representation then
    raise exception 'Fila %: un número no tiene formato válido', v_n;
  when check_violation then
    raise exception 'Fila %: piezas por empaque debe ser mayor a 0 y stock mínimo 0 o más', v_n;
end $$;

-- ---------------------------------------------------------------------
-- 8. registrar_ajuste: no se crean documentos sin productos
-- ---------------------------------------------------------------------
create or replace function registrar_ajuste(p_tipo tipo_movimiento, p_ubicacion uuid,
                                            p_motivo text, p_renglones jsonb)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := exigir_rol('vendedor', 'admin', 'bodega');
  v_rol rol_usuario := rol_actual();
  v_ubic ubicaciones%rowtype; v_jornada uuid; v_id uuid; v_folio text; r jsonb;
  v_origen uuid; v_destino uuid;
begin
  if p_tipo not in ('devolucion_bodega', 'merma', 'ajuste_entrada', 'ajuste_salida') then
    raise exception 'Tipo de ajuste no válido: %', p_tipo;
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  if jsonb_typeof(p_renglones) is distinct from 'array' or jsonb_array_length(p_renglones) = 0 then
    raise exception 'El ajuste no tiene productos';
  end if;
  select * into v_ubic from ubicaciones where id = p_ubicacion;
  if v_ubic.id is null then raise exception 'Ubicación inexistente'; end if;

  if p_tipo in ('ajuste_entrada', 'ajuste_salida') and v_rol <> 'admin' then
    raise exception 'Solo el administrador autoriza ajustes de inventario' using errcode = '42501';
  end if;
  if v_rol = 'vendedor' and v_ubic.vendedor_id is distinct from v_uid then
    raise exception 'Solo puede afectar su propio inventario' using errcode = '42501';
  end if;
  if p_tipo = 'devolucion_bodega' and v_ubic.tipo <> 'vendedor' then
    raise exception 'La devolución a bodega parte de la ubicación de un vendedor';
  end if;

  if v_ubic.tipo = 'vendedor' then
    select id into v_jornada from jornadas_ruta
     where ubicacion_id = v_ubic.id and estado in ('preparacion', 'abierta');
  end if;

  v_origen  := case when p_tipo = 'ajuste_entrada' then null else p_ubicacion end;
  v_destino := case p_tipo when 'ajuste_entrada' then p_ubicacion
                           when 'devolucion_bodega' then bodega_principal() end;

  v_folio := siguiente_folio(case when p_tipo::text like 'ajuste%' then 'AJ' else 'DE' end);
  insert into ajustes (folio, tipo, ubicacion_id, motivo, autorizado_por, jornada_id)
  values (v_folio, p_tipo, p_ubicacion, p_motivo, v_uid, v_jornada) returning id into v_id;

  for r in select * from jsonb_array_elements(p_renglones) loop
    insert into movimientos_inventario
      (producto_id, cantidad, tipo, origen_id, destino_id, usuario_id, motivo,
       referencia_tipo, referencia_id, costo_unitario, jornada_id)
    values ((r->>'producto_id')::uuid, (r->>'cantidad')::int, p_tipo, v_origen, v_destino,
            v_uid, p_motivo, 'ajuste', v_id,
            precio_vigente((r->>'producto_id')::uuid, 'costo'), v_jornada);
  end loop;
  return v_folio;
end $$;
