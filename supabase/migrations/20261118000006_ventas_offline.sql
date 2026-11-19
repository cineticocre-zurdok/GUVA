-- =====================================================================
-- GUVA · Migración 0006 · Entrega 2: ventas en ruta con cola offline
-- - registrar_venta_offline: el teléfono puede capturar una venta de
--   contado sin señal y pedir al servidor que la liquide por su total.
--   Así, si un precio cambió entre la captura y la sincronización, la
--   venta no se rechaza: el servidor decide precio y cobro (como siempre).
-- =====================================================================

-- p = lo mismo que registrar_venta, pero en lugar de "pagos" puede traer
--   "liquidar": {"id": uuid, "metodo": "efectivo"|"transferencia"|"otro", "referencia"?: text}
-- El servidor calcula el total con los precios vigentes y registra un solo
-- cobro por ese total. Idempotente por p->>'id' (igual que registrar_venta).
create or replace function registrar_venta_offline(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid   uuid := exigir_rol('vendedor', 'admin');
  v_liq   jsonb := p->'liquidar';
  v_lista lista_precio;
  v_total numeric := 0;
  v_precio numeric;
  r jsonb;
begin
  -- Sin "liquidar", o venta ya registrada (reenvío): registrar_venta decide
  if v_liq is null or jsonb_typeof(v_liq) <> 'object'
     or exists (select 1 from ventas where id = (p->>'id')::uuid) then
    return registrar_venta(p - 'liquidar');
  end if;
  if jsonb_array_length(coalesce(p->'pagos', '[]')) > 0 then
    raise exception 'La venta trae "pagos" y "liquidar"; use solo uno';
  end if;
  if coalesce(p->>'condicion', 'contado') <> 'contado' then
    raise exception 'Solo una venta de contado se liquida por su total';
  end if;

  -- Misma regla de cliente que registrar_venta
  if p->>'cliente_id' is not null then
    select lista_precio into v_lista from clientes where id = (p->>'cliente_id')::uuid and activo;
  else
    select lista_precio into v_lista from clientes
     where tipo = 'mostrador' and activo order by creado_en limit 1;
  end if;

  if v_lista is not null then
    for r in select * from jsonb_array_elements(coalesce(p->'renglones', '[]')) loop
      if r ? 'precio_especial' then
        v_precio := round((r->>'precio_especial')::numeric, 2);
      else
        v_precio := precio_vigente((r->>'producto_id')::uuid, v_lista);
      end if;
      -- Si falta un precio, registrar_venta lanza el error claro del renglón
      v_total := v_total + coalesce((r->>'cantidad')::int * v_precio, 0)
                         - round(coalesce((r->>'descuento')::numeric, 0), 2);
    end loop;
  end if;

  p := p - 'liquidar';
  if v_total > 0 then
    p := jsonb_set(p, '{pagos}', jsonb_build_array(jsonb_build_object(
           'id', v_liq->>'id', 'metodo', v_liq->>'metodo',
           'monto', v_total, 'referencia', v_liq->>'referencia')));
  end if;
  return registrar_venta(p);
end $$;

grant execute on function registrar_venta_offline(jsonb) to authenticated;
