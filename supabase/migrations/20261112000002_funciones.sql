-- =====================================================================
-- GUVA · Migración 0002 · Reglas de negocio
-- Todas las escrituras operativas pasan por estas funciones (RPC).
-- Cada una corre en una sola transacción: o se registra todo o nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function rol_actual() returns rol_usuario
language sql stable security definer set search_path = public, pg_temp as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create or replace function exigir_rol(variadic p_roles rol_usuario[]) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rol rol_usuario := rol_actual();
begin
  if v_rol is null then
    raise exception 'Usuario sin perfil activo' using errcode = '42501';
  end if;
  if not v_rol = any(p_roles) then
    raise exception 'Permiso denegado para el rol %', v_rol using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function siguiente_folio(p_serie text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v integer;
begin
  update folios set ultimo = ultimo + 1 where serie = p_serie returning ultimo into v;
  if v is null then raise exception 'Serie de folio inexistente: %', p_serie; end if;
  return p_serie || '-' || lpad(v::text, 6, '0');
end $$;

create or replace function precio_vigente(p_producto uuid, p_lista lista_precio)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select precio from precios_historial
   where producto_id = p_producto and lista = p_lista and vigente_desde <= now()
   order by vigente_desde desc, id desc limit 1
$$;

create or replace function bodega_principal() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from ubicaciones where tipo = 'bodega' and activo order by nombre limit 1
$$;

-- ---------------------------------------------------------------------
-- Movimientos => existencias (único camino para cambiar existencias)
-- ---------------------------------------------------------------------
create or replace function aplicar_movimiento() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actual integer; v_nombre text;
begin
  if new.origen_id is not null then
    select cantidad into v_actual from existencias
     where ubicacion_id = new.origen_id and producto_id = new.producto_id
     for update;                                   -- bloquea la fila: sin carreras
    if coalesce(v_actual, 0) < new.cantidad then
      select nombre into v_nombre from productos where id = new.producto_id;
      raise exception 'Existencia insuficiente de "%": hay %, se requieren %',
        v_nombre, coalesce(v_actual, 0), new.cantidad using errcode = 'P0001';
    end if;
    update existencias set cantidad = cantidad - new.cantidad, actualizado_en = now()
     where ubicacion_id = new.origen_id and producto_id = new.producto_id;
  end if;
  if new.destino_id is not null then
    insert into existencias (ubicacion_id, producto_id, cantidad)
    values (new.destino_id, new.producto_id, new.cantidad)
    on conflict (ubicacion_id, producto_id)
    do update set cantidad = existencias.cantidad + excluded.cantidad, actualizado_en = now();
  end if;
  return new;
end $$;

create trigger trg_aplicar_movimiento after insert on movimientos_inventario
for each row execute function aplicar_movimiento();

-- Registros inmutables: no se borran ni se editan; se compensan.
create or replace function prohibir_cambio() returns trigger
language plpgsql as $$
begin
  raise exception 'Operación % no permitida sobre %. Use una cancelación o movimiento compensatorio.',
    tg_op, tg_table_name using errcode = '42501';
end $$;

create trigger trg_inmutable before update or delete on movimientos_inventario
  for each row execute function prohibir_cambio();
create trigger trg_inmutable before update or delete on venta_detalle
  for each row execute function prohibir_cambio();
create trigger trg_inmutable before update or delete on cierre_detalle
  for each row execute function prohibir_cambio();
create trigger trg_inmutable before update or delete on precios_historial
  for each row execute function prohibir_cambio();
create trigger trg_sin_borrado before delete on ventas
  for each row execute function prohibir_cambio();
create trigger trg_sin_borrado before delete on pagos
  for each row execute function prohibir_cambio();
create trigger trg_sin_borrado before delete on gastos
  for each row execute function prohibir_cambio();
create trigger trg_sin_borrado before delete on cierres_ruta
  for each row execute function prohibir_cambio();
create trigger trg_sin_borrado before delete on auditoria
  for each row execute function prohibir_cambio();

-- ---------------------------------------------------------------------
-- Auditoría genérica
-- ---------------------------------------------------------------------
create or replace function auditar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into auditoria (usuario_id, tabla, operacion, registro_id, antes, despues)
  values (auth.uid(), tg_table_name, tg_op,
          coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id'),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['configuracion','perfiles','ubicaciones','productos','precios_historial',
                           'clientes','jornadas_ruta','cargas','ventas','pagos','gastos',
                           'entradas','ajustes','cierres_ruta']
  loop
    execute format('create trigger trg_auditoria after insert or update or delete on %I
                    for each row execute function auditar()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Catálogo: precios y costos (solo administrador)
-- ---------------------------------------------------------------------
create or replace function establecer_precio(p_producto uuid, p_lista lista_precio,
                                             p_precio numeric, p_motivo text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin');
begin
  insert into precios_historial (producto_id, lista, precio, registrado_por, motivo)
  values (p_producto, p_lista, round(p_precio, 2), v_uid, p_motivo);
end $$;

-- ---------------------------------------------------------------------
-- Entrada de mercancía a bodega
-- p_renglones: [{"producto_id": uuid, "cantidad": int}]
-- ---------------------------------------------------------------------
create or replace function registrar_entrada(p_referencia text, p_renglones jsonb,
                                             p_notas text default null)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin', 'bodega');
        v_id uuid; v_folio text; r jsonb;
begin
  if jsonb_array_length(coalesce(p_renglones, '[]')) = 0 then
    raise exception 'La entrada no tiene productos';
  end if;
  v_folio := siguiente_folio('EN');
  insert into entradas (folio, referencia_proveedor, registrada_por, notas)
  values (v_folio, p_referencia, v_uid, p_notas) returning id into v_id;
  for r in select * from jsonb_array_elements(p_renglones) loop
    insert into movimientos_inventario
      (producto_id, cantidad, tipo, destino_id, usuario_id, motivo,
       referencia_tipo, referencia_id, costo_unitario)
    values ((r->>'producto_id')::uuid, (r->>'cantidad')::int, 'entrada_compra',
            bodega_principal(), v_uid, p_referencia, 'entrada', v_id,
            precio_vigente((r->>'producto_id')::uuid, 'costo'));
  end loop;
  return v_folio;
end $$;

-- ---------------------------------------------------------------------
-- Jornadas y cargas de ruta
-- ---------------------------------------------------------------------
create or replace function crear_jornada(p_vendedor uuid, p_fecha date default hoy())
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin');
        v_ubic uuid; v_id uuid;
begin
  select id into v_ubic from ubicaciones where vendedor_id = p_vendedor and activo;
  if v_ubic is null then
    raise exception 'El vendedor no tiene ubicación de inventario asignada';
  end if;
  insert into jornadas_ruta (vendedor_id, ubicacion_id, fecha, creada_por)
  values (p_vendedor, v_ubic, p_fecha, v_uid) returning id into v_id;
  -- Fotografía de lo que el vendedor ya traía
  insert into jornada_saldo_inicial (jornada_id, producto_id, cantidad)
  select v_id, producto_id, cantidad from existencias
   where ubicacion_id = v_ubic and cantidad > 0;
  return v_id;
end $$;

create or replace function crear_carga(p_jornada uuid, p_tipo tipo_carga, p_renglones jsonb,
                                       p_notas text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin', 'bodega');
        v_estado estado_jornada; v_id uuid;
begin
  select estado into v_estado from jornadas_ruta where id = p_jornada for update;
  if v_estado is null or v_estado not in ('preparacion', 'abierta') then
    raise exception 'La jornada no admite cargas (estado %)', v_estado;
  end if;
  insert into cargas (jornada_id, tipo, preparada_por, notas)
  values (p_jornada, p_tipo, v_uid, p_notas) returning id into v_id;
  insert into carga_detalle (carga_id, producto_id, cantidad)
  select v_id, (r->>'producto_id')::uuid, sum((r->>'cantidad')::int)
    from jsonb_array_elements(p_renglones) r group by 2;
  if not found then raise exception 'La carga no tiene productos'; end if;
  return v_id;
end $$;

create or replace function despachar_carga(p_carga uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin', 'bodega');
        c record; d record; v_folio text;
begin
  select ca.*, j.ubicacion_id into c from cargas ca join jornadas_ruta j on j.id = ca.jornada_id
   where ca.id = p_carga for update of ca;
  if c.id is null or c.estado <> 'preparando' then
    raise exception 'La carga no está en preparación';
  end if;
  v_folio := siguiente_folio('CA');
  for d in select * from carga_detalle where carga_id = p_carga loop
    insert into movimientos_inventario
      (producto_id, cantidad, tipo, origen_id, destino_id, usuario_id, motivo,
       referencia_tipo, referencia_id, jornada_id)
    values (d.producto_id, d.cantidad, 'traspaso_carga', bodega_principal(), c.ubicacion_id,
            v_uid, 'Carga ' || c.tipo, 'carga', p_carga, c.jornada_id);
  end loop;
  update cargas set estado = 'por_confirmar', folio = v_folio, despachada_en = now()
   where id = p_carga;
  return v_folio;
end $$;

create or replace function confirmar_carga(p_carga uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('vendedor', 'admin');
        c record;
begin
  select ca.id, ca.estado, ca.jornada_id, j.vendedor_id into c
    from cargas ca join jornadas_ruta j on j.id = ca.jornada_id
   where ca.id = p_carga for update of ca;
  if c.id is null or c.estado <> 'por_confirmar' then
    raise exception 'La carga no está pendiente de confirmación';
  end if;
  if rol_actual() = 'vendedor' and c.vendedor_id <> v_uid then
    raise exception 'La carga pertenece a otro vendedor' using errcode = '42501';
  end if;
  update cargas set estado = 'recibida', recibida_en = now(), recibida_por = v_uid
   where id = p_carga;
  update jornadas_ruta set estado = 'abierta', abierta_en = coalesce(abierta_en, now())
   where id = c.jornada_id and estado = 'preparacion';
end $$;

-- ---------------------------------------------------------------------
-- Venta (ruta, mayoreo o mostrador). Idempotente por p->>'id'.
-- p = {
--   id, canal, cliente_id?, jornada_id?, condicion?, registrada_en?, dispositivo_id?, notas?,
--   renglones: [{producto_id, cantidad, descuento?, precio_especial?}],
--   pagos:     [{id, metodo, monto, referencia?}]
-- }
-- Precios y costos los decide el servidor, nunca el dispositivo.
-- ---------------------------------------------------------------------
create or replace function registrar_venta(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid     uuid := exigir_rol('vendedor', 'admin');
  v_rol     rol_usuario := rol_actual();
  v_id      uuid := (p->>'id')::uuid;
  v_canal   canal_venta := (p->>'canal')::canal_venta;
  v_cond    condicion_pago := coalesce(p->>'condicion', 'contado')::condicion_pago;
  v_fecha   timestamptz := coalesce((p->>'registrada_en')::timestamptz, now());
  v_cli     clientes%rowtype;
  v_jor     jornadas_ruta%rowtype;
  v_ubic    uuid;
  v_maxdesc numeric;
  v_folio   text;
  v_existe  record;
  r jsonb; v_n smallint := 0;
  v_lista lista_precio; v_precio numeric; v_costo numeric; v_desc numeric; v_cant int;
  v_subtotal numeric := 0; v_descuento numeric := 0; v_costo_total numeric := 0;
  v_pagado numeric := 0; v_saldo_cli numeric; v_venc date;
begin
  if v_id is null then raise exception 'La venta requiere un id generado en el dispositivo'; end if;

  -- Idempotencia: si ya llegó, se devuelve lo registrado sin tocar inventario.
  select id, folio, vendedor_id, total into v_existe from ventas where id = v_id;
  if found then
    if v_existe.vendedor_id <> v_uid and v_rol <> 'admin' then
      raise exception 'Identificador de venta en uso' using errcode = '42501';
    end if;
    return jsonb_build_object('id', v_existe.id, 'folio', v_existe.folio,
                              'total', v_existe.total, 'duplicada', true);
  end if;

  -- Canal, ubicación de salida y permisos
  if v_canal = 'ruta' then
    select * into v_jor from jornadas_ruta where id = (p->>'jornada_id')::uuid for share;
    if v_jor.id is null or v_jor.estado <> 'abierta' then
      raise exception 'No hay una jornada de ruta abierta para registrar la venta';
    end if;
    if v_rol = 'vendedor' and v_jor.vendedor_id <> v_uid then
      raise exception 'La jornada pertenece a otro vendedor' using errcode = '42501';
    end if;
    v_ubic := v_jor.ubicacion_id;
  else
    if v_rol <> 'admin' then
      raise exception 'Solo el administrador registra ventas de mayoreo o mostrador'
        using errcode = '42501';
    end if;
    v_ubic := bodega_principal();
  end if;

  if p ? 'cliente_id' and p->>'cliente_id' is not null then
    select * into v_cli from clientes where id = (p->>'cliente_id')::uuid and activo;
  else
    select * into v_cli from clientes where tipo = 'mostrador' and activo order by creado_en limit 1;
  end if;
  if v_cli.id is null then raise exception 'Cliente inexistente o inactivo'; end if;

  select descuento_max_vendedor_pct into v_maxdesc from configuracion;

  insert into ventas (id, canal, cliente_id, vendedor_id, jornada_id, ubicacion_id, condicion,
                      subtotal, descuento, total, costo_total, registrada_en, dispositivo_id, notas)
  values (v_id, v_canal, v_cli.id, coalesce(v_jor.vendedor_id, v_uid), v_jor.id, v_ubic, 'contado',
          0, 0, 0, 0, v_fecha, p->>'dispositivo_id', p->>'notas');

  for r in select * from jsonb_array_elements(coalesce(p->'renglones', '[]')) loop
    v_n := v_n + 1;
    v_cant := (r->>'cantidad')::int;
    if v_cant is null or v_cant <= 0 then raise exception 'Cantidad inválida en renglón %', v_n; end if;

    if r ? 'precio_especial' then
      if v_rol <> 'admin' then
        raise exception 'Solo el administrador autoriza precios especiales' using errcode = '42501';
      end if;
      v_lista := 'especial'; v_precio := round((r->>'precio_especial')::numeric, 2);
    else
      v_lista := v_cli.lista_precio;
      v_precio := precio_vigente((r->>'producto_id')::uuid, v_lista);
    end if;
    if v_precio is null then
      raise exception 'El producto del renglón % no tiene precio % vigente', v_n, v_lista;
    end if;

    v_costo := precio_vigente((r->>'producto_id')::uuid, 'costo');
    if v_costo is null then
      raise exception 'El producto del renglón % no tiene costo registrado', v_n;
    end if;

    v_desc := round(coalesce((r->>'descuento')::numeric, 0), 2);
    if v_desc < 0 or v_desc > v_cant * v_precio then
      raise exception 'Descuento inválido en renglón %', v_n;
    end if;
    if v_rol = 'vendedor' and v_desc > round(v_cant * v_precio * v_maxdesc / 100, 2) then
      raise exception 'El descuento del renglón % excede el máximo autorizado (% %%)', v_n, v_maxdesc;
    end if;

    insert into venta_detalle (venta_id, renglon, producto_id, cantidad, lista_aplicada,
                               precio_unitario, descuento, importe, costo_unitario)
    values (v_id, v_n, (r->>'producto_id')::uuid, v_cant, v_lista,
            v_precio, v_desc, v_cant * v_precio - v_desc, v_costo);

    -- Descuenta inventario (falla toda la venta si no alcanza)
    insert into movimientos_inventario
      (producto_id, cantidad, tipo, origen_id, usuario_id, referencia_tipo, referencia_id,
       costo_unitario, jornada_id)
    values ((r->>'producto_id')::uuid, v_cant, 'salida_venta', v_ubic, v_uid, 'venta', v_id,
            v_costo, v_jor.id);

    v_subtotal := v_subtotal + v_cant * v_precio;
    v_descuento := v_descuento + v_desc;
    v_costo_total := v_costo_total + v_cant * v_costo;
  end loop;
  if v_n = 0 then raise exception 'La venta no tiene productos'; end if;

  -- Condición de pago
  if v_cond = 'credito' then
    if not v_cli.permite_credito or v_cli.dias_credito = 0 then
      raise exception 'El cliente "%" no tiene crédito autorizado', v_cli.nombre;
    end if;
    select coalesce(sum(saldo), 0) into v_saldo_cli from v_saldos_ventas where cliente_id = v_cli.id;
    if v_saldo_cli + (v_subtotal - v_descuento) > v_cli.limite_credito then
      raise exception 'Límite de crédito excedido: saldo %, venta %, límite %',
        v_saldo_cli, v_subtotal - v_descuento, v_cli.limite_credito;
    end if;
    v_venc := (v_fecha at time zone 'America/Mexico_City')::date + v_cli.dias_credito;
  end if;

  v_folio := siguiente_folio(case v_canal when 'ruta' then 'VR' when 'mayoreo' then 'VM' else 'VT' end);
  update ventas set folio = v_folio, subtotal = v_subtotal, descuento = v_descuento,
                    total = v_subtotal - v_descuento, costo_total = v_costo_total,
                    condicion = v_cond, fecha_vencimiento = v_venc
   where id = v_id;

  -- Cobros incluidos en la venta
  for r in select * from jsonb_array_elements(coalesce(p->'pagos', '[]')) loop
    insert into pagos (id, folio, venta_id, cliente_id, metodo, monto, referencia,
                       jornada_id, recibido_por, registrado_en)
    values ((r->>'id')::uuid, siguiente_folio('CO'), v_id, v_cli.id, (r->>'metodo')::metodo_pago,
            round((r->>'monto')::numeric, 2), r->>'referencia', v_jor.id, v_uid, v_fecha);
    v_pagado := v_pagado + round((r->>'monto')::numeric, 2);
  end loop;

  if v_pagado > v_subtotal - v_descuento then
    raise exception 'Los cobros (%) exceden el total de la venta (%)', v_pagado, v_subtotal - v_descuento;
  end if;
  if v_cond = 'contado' and v_pagado <> v_subtotal - v_descuento then
    raise exception 'Venta de contado: los cobros (%) deben igualar el total (%)',
      v_pagado, v_subtotal - v_descuento;
  end if;

  return jsonb_build_object('id', v_id, 'folio', v_folio, 'total', v_subtotal - v_descuento,
                            'duplicada', false);
end $$;

-- ---------------------------------------------------------------------
-- Cobro / abono a una venta a crédito. Idempotente por p->>'id'.
-- p = {id, venta_id, metodo, monto, referencia?, registrado_en?}
-- ---------------------------------------------------------------------
create or replace function registrar_pago(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := exigir_rol('vendedor', 'admin');
  v_rol rol_usuario := rol_actual();
  v_venta ventas%rowtype; v_saldo numeric; v_monto numeric := round((p->>'monto')::numeric, 2);
  v_jornada uuid; v_folio text; v_existe record;
begin
  select id, folio into v_existe from pagos where id = (p->>'id')::uuid;
  if found then
    return jsonb_build_object('id', v_existe.id, 'folio', v_existe.folio, 'duplicada', true);
  end if;

  select * into v_venta from ventas where id = (p->>'venta_id')::uuid for update;  -- serializa saldos
  if v_venta.id is null or v_venta.estado <> 'cerrada' then
    raise exception 'Venta inexistente o cancelada';
  end if;

  if v_rol = 'vendedor' then
    select id into v_jornada from jornadas_ruta where vendedor_id = v_uid and estado = 'abierta';
    if v_jornada is null then
      raise exception 'Debe tener una jornada abierta para registrar cobros';
    end if;
  end if;

  select saldo into v_saldo from v_saldos_ventas where venta_id = v_venta.id;
  if v_monto <= 0 or v_monto > v_saldo then
    raise exception 'Monto inválido: el saldo pendiente es %', v_saldo;
  end if;

  v_folio := siguiente_folio('CO');
  insert into pagos (id, folio, venta_id, cliente_id, metodo, monto, referencia,
                     jornada_id, recibido_por, registrado_en)
  values ((p->>'id')::uuid, v_folio, v_venta.id, v_venta.cliente_id, (p->>'metodo')::metodo_pago,
          v_monto, p->>'referencia', v_jornada, v_uid,
          coalesce((p->>'registrado_en')::timestamptz, now()));
  return jsonb_build_object('id', p->>'id', 'folio', v_folio, 'saldo', v_saldo - v_monto,
                            'duplicada', false);
end $$;

-- ---------------------------------------------------------------------
-- Gasto. Idempotente por p->>'id'.
-- p = {id, categoria, concepto, monto, metodo, fecha?, comprobante_path?, registrado_en?}
-- ---------------------------------------------------------------------
create or replace function registrar_gasto(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := exigir_rol('vendedor', 'admin');
  v_jornada uuid; v_folio text; v_existe record;
begin
  select id, folio into v_existe from gastos where id = (p->>'id')::uuid;
  if found then
    return jsonb_build_object('id', v_existe.id, 'folio', v_existe.folio, 'duplicada', true);
  end if;
  select id into v_jornada from jornadas_ruta where vendedor_id = v_uid and estado = 'abierta';
  if rol_actual() = 'vendedor' and v_jornada is null then
    raise exception 'Debe tener una jornada abierta para registrar gastos de ruta';
  end if;
  v_folio := siguiente_folio('GA');
  insert into gastos (id, folio, fecha, categoria, concepto, monto, metodo, jornada_id,
                      usuario_id, comprobante_path, registrado_en)
  values ((p->>'id')::uuid, v_folio, coalesce((p->>'fecha')::date, hoy()),
          (p->>'categoria')::categoria_gasto, p->>'concepto', round((p->>'monto')::numeric, 2),
          (p->>'metodo')::metodo_pago, v_jornada, v_uid, p->>'comprobante_path',
          coalesce((p->>'registrado_en')::timestamptz, now()));
  return jsonb_build_object('id', p->>'id', 'folio', v_folio, 'duplicada', false);
end $$;

-- ---------------------------------------------------------------------
-- Devoluciones, mermas y ajustes
-- p_tipo: devolucion_bodega | merma | ajuste_entrada | ajuste_salida
-- Vendedor: solo devolución a bodega y merma desde su propia ubicación.
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

-- ---------------------------------------------------------------------
-- Cancelaciones (solo administrador, con motivo; nada se borra)
-- ---------------------------------------------------------------------
create or replace function cancelar_venta(p_venta uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin'); v ventas%rowtype; d record;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'El motivo es obligatorio'; end if;
  select * into v from ventas where id = p_venta for update;
  if v.id is null or v.estado <> 'cerrada' then raise exception 'La venta no está vigente'; end if;
  if v.jornada_id is not null and
     (select estado from jornadas_ruta where id = v.jornada_id) in ('en_cierre', 'cerrada') then
    raise exception 'La jornada ya fue cerrada; registre una devolución de cliente';
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
declare v_uid uuid := exigir_rol('admin');
begin
  update gastos set estado = 'cancelada', cancelado_en = now(), cancelado_por = v_uid,
                    motivo_cancelacion = p_motivo
   where id = p_gasto and estado = 'cerrada';
  if not found then raise exception 'Gasto inexistente o ya cancelado'; end if;
end $$;

create or replace function cancelar_pago(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin');
begin
  update pagos set estado = 'cancelada', cancelado_en = now(), cancelado_por = v_uid,
                   motivo_cancelacion = p_motivo
   where id = p_pago and estado = 'cerrada';
  if not found then raise exception 'Cobro inexistente o ya cancelado'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Vistas de consulta (respetan RLS: security_invoker)
-- ---------------------------------------------------------------------
create view v_precios_vigentes with (security_invoker = true) as
select distinct on (producto_id, lista) producto_id, lista, precio, vigente_desde
  from precios_historial where vigente_desde <= now()
 order by producto_id, lista, vigente_desde desc, id desc;

create view v_saldos_ventas with (security_invoker = true) as
select v.id as venta_id, v.folio, v.cliente_id, v.canal, v.condicion, v.total,
       coalesce(sum(p.monto) filter (where p.estado = 'cerrada'), 0) as pagado,
       v.total - coalesce(sum(p.monto) filter (where p.estado = 'cerrada'), 0) as saldo,
       v.fecha_vencimiento,
       (v.fecha_vencimiento < hoy()
        and v.total > coalesce(sum(p.monto) filter (where p.estado = 'cerrada'), 0)) as vencida
  from ventas v left join pagos p on p.venta_id = v.id
 where v.estado = 'cerrada'
 group by v.id;

create view v_existencias with (security_invoker = true) as
select e.ubicacion_id, u.nombre as ubicacion, u.tipo as tipo_ubicacion,
       e.producto_id, pr.codigo_interno, pr.nombre as producto, l.nombre as linea,
       e.cantidad, pr.stock_minimo,
       (u.tipo = 'bodega' and e.cantidad <= pr.stock_minimo) as bajo_minimo
  from existencias e
  join ubicaciones u on u.id = e.ubicacion_id
  join productos pr on pr.id = e.producto_id
  join lineas l on l.id = pr.linea_id;

-- ---- Vistas financieras: solo administrador ----
-- Corren con permisos del dueño (pueden leer costos) y filtran por rol_actual().

-- Resumen financiero diario. Distingue venta, cobro, costo, margen y gasto.
create view v_resumen_diario as
with v as (
  select (registrada_en at time zone 'America/Mexico_City')::date as dia,
         sum(total) as venta_neta, sum(costo_total) as costo_vendido,
         sum(total) filter (where canal = 'ruta') as venta_ruta,
         sum(total) filter (where canal = 'mayoreo') as venta_mayoreo,
         sum(total) filter (where canal = 'mostrador') as venta_mostrador,
         sum(total) filter (where condicion = 'credito') as venta_credito
    from ventas where estado = 'cerrada' and rol_actual() = 'admin' group by 1),
c as (
  select (registrado_en at time zone 'America/Mexico_City')::date as dia, sum(monto) as cobrado
    from pagos where estado = 'cerrada' and rol_actual() = 'admin' group by 1),
g as (
  select fecha as dia, sum(monto) as gastos from gastos
   where estado = 'cerrada' and rol_actual() = 'admin' group by 1)
select d.dia,
       coalesce(v.venta_neta, 0)      as venta_neta,
       coalesce(v.venta_ruta, 0)      as venta_ruta,
       coalesce(v.venta_mayoreo, 0)   as venta_mayoreo,
       coalesce(v.venta_mostrador, 0) as venta_mostrador,
       coalesce(v.venta_credito, 0)   as venta_credito,
       coalesce(v.costo_vendido, 0)   as costo_vendido,
       coalesce(v.venta_neta, 0) - coalesce(v.costo_vendido, 0) as margen_bruto,
       coalesce(c.cobrado, 0)         as cobrado,
       coalesce(g.gastos, 0)          as gastos,
       coalesce(v.venta_neta, 0) - coalesce(v.costo_vendido, 0) - coalesce(g.gastos, 0)
                                      as resultado_operativo_estimado,
       coalesce(c.cobrado, 0) - coalesce(g.gastos, 0) as flujo_efectivo_operativo
  from (select dia from v union select dia from c union select dia from g) d
  left join v using (dia) left join c using (dia) left join g using (dia);


-- Rentabilidad por renglón vendido: base para producto, cliente, vendedor, canal y periodo
create view v_rentabilidad as
select v.id as venta_id, v.folio,
       (v.registrada_en at time zone 'America/Mexico_City')::date as dia,
       v.canal, v.cliente_id, v.vendedor_id, v.jornada_id, d.producto_id, pr.linea_id,
       d.cantidad, d.lista_aplicada, d.precio_unitario, d.descuento,
       d.importe                               as venta_neta,
       d.cantidad * d.costo_unitario           as costo_vendido,
       d.importe - d.cantidad * d.costo_unitario as margen_bruto,
       case when d.importe > 0
            then round((d.importe - d.cantidad * d.costo_unitario) / d.importe * 100, 2) end
                                               as margen_bruto_pct
  from ventas v
  join venta_detalle d on d.venta_id = v.id
  join productos pr on pr.id = d.producto_id
 where v.estado = 'cerrada' and rol_actual() = 'admin';

-- Inventario valorizado a costo vigente
create view v_inventario_valorizado as
select e.ubicacion_id, u.nombre as ubicacion, e.producto_id, pr.nombre as producto,
       e.cantidad, c.precio as costo_unitario,
       e.cantidad * coalesce(c.precio, 0) as valor
  from existencias e join ubicaciones u on u.id = e.ubicacion_id
  join productos pr on pr.id = e.producto_id
  left join lateral (select precio from precios_historial h
                      where h.producto_id = e.producto_id and h.lista = 'costo'
                        and h.vigente_desde <= now()
                      order by h.vigente_desde desc, h.id desc limit 1) c on true
 where rol_actual() = 'admin';

-- ---------------------------------------------------------------------
-- Cierre de ruta
-- p_conteo: [{"producto_id": uuid, "cantidad": int}] conteo físico al final
-- ---------------------------------------------------------------------
create or replace function calcular_cierre(p_jornada uuid)
returns table (producto_id uuid, inicial int, adicional int, vendido int,
               devuelto int, merma int, final_teorico int)
language sql stable security definer set search_path = public, pg_temp as $$
  with j as (select * from jornadas_ruta where id = p_jornada),
  m as (
    select mi.producto_id,
      sum(case when mi.tipo = 'traspaso_carga' and ca.tipo = 'inicial'   then mi.cantidad else 0 end) as carga_ini,
      sum(case when mi.tipo = 'traspaso_carga' and ca.tipo = 'adicional' then mi.cantidad else 0 end)
        + sum(case when mi.tipo = 'ajuste_entrada' then mi.cantidad else 0 end) as adicional,
      sum(case when mi.tipo = 'salida_venta' then mi.cantidad
               when mi.tipo in ('cancelacion_venta', 'devolucion_cliente') then -mi.cantidad
               else 0 end) as vendido,
      sum(case when mi.tipo = 'devolucion_bodega' then mi.cantidad else 0 end) as devuelto,
      sum(case when mi.tipo in ('merma', 'ajuste_salida') then mi.cantidad else 0 end) as merma
    from movimientos_inventario mi
    join j on mi.jornada_id = j.id
          and (mi.origen_id = j.ubicacion_id or mi.destino_id = j.ubicacion_id)
    left join cargas ca on mi.referencia_tipo = 'carga' and ca.id = mi.referencia_id
    group by mi.producto_id)
  select coalesce(m.producto_id, s.producto_id),
         (coalesce(s.cantidad, 0) + coalesce(m.carga_ini, 0))::int,
         coalesce(m.adicional, 0)::int, coalesce(m.vendido, 0)::int,
         coalesce(m.devuelto, 0)::int, coalesce(m.merma, 0)::int,
         (coalesce(s.cantidad, 0) + coalesce(m.carga_ini, 0) + coalesce(m.adicional, 0)
          - coalesce(m.vendido, 0) - coalesce(m.devuelto, 0) - coalesce(m.merma, 0))::int
    from m full join (select * from jornada_saldo_inicial where jornada_id = p_jornada) s
      on s.producto_id = m.producto_id
$$;

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

-- El administrador revisa: las diferencias de mercancía se registran como
-- ajustes trazables y la jornada queda cerrada.
create or replace function revisar_cierre(p_cierre uuid, p_observaciones text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin'); c cierres_ruta%rowtype; j jornadas_ruta%rowtype;
        d record; v_aj uuid;
begin
  select * into c from cierres_ruta where id = p_cierre for update;
  if c.id is null or c.revisado_en is not null then raise exception 'Cierre inexistente o ya revisado'; end if;
  select * into j from jornadas_ruta where id = c.jornada_id for update;

  if exists (select 1 from cierre_detalle where cierre_id = p_cierre and diferencia <> 0) then
    insert into ajustes (folio, tipo, ubicacion_id, motivo, autorizado_por, jornada_id)
    values (siguiente_folio('AJ'), 'ajuste_salida', j.ubicacion_id,
            'Diferencia en cierre ' || c.folio, v_uid, j.id)
    returning id into v_aj;
    for d in select * from cierre_detalle where cierre_id = p_cierre and diferencia <> 0 loop
      insert into movimientos_inventario
        (producto_id, cantidad, tipo, origen_id, destino_id, usuario_id, motivo,
         referencia_tipo, referencia_id, costo_unitario, jornada_id)
      values (d.producto_id, abs(d.diferencia),
              case when d.diferencia < 0 then 'ajuste_salida' else 'ajuste_entrada' end::tipo_movimiento,
              case when d.diferencia < 0 then j.ubicacion_id end,
              case when d.diferencia > 0 then j.ubicacion_id end,
              v_uid, 'Diferencia en cierre ' || c.folio, 'ajuste', v_aj,
              precio_vigente(d.producto_id, 'costo'), j.id);
    end loop;
  end if;

  update cierres_ruta set revisado_por = v_uid, revisado_en = now(),
         observaciones = concat_ws(' | ', observaciones, p_observaciones)
   where id = p_cierre;
  update jornadas_ruta set estado = 'cerrada', cerrada_en = now() where id = j.id;
end $$;
