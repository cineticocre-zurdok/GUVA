-- =====================================================================
-- GUVA · Migración 0004 · Importación de catálogo y alta de usuarios
-- =====================================================================

-- ---------------------------------------------------------------------
-- Importación masiva de productos (CSV / Excel convertido en el navegador)
-- p_filas: [{codigo_interno, codigo_barras?, nombre, marca, linea, presentacion?,
--            unidad_medida?, piezas_por_empaque?, stock_minimo?,
--            costo?, precio_detalle?, precio_mayoreo?}]
-- Crea o actualiza por codigo_interno. Todo o nada: un error cancela la importación.
-- Solo registra precio cuando viene y es distinto del vigente (historial limpio).
-- ---------------------------------------------------------------------
create or replace function importar_productos(p_filas jsonb, p_motivo text default 'Importación de catálogo')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := exigir_rol('admin');
  r jsonb; v_n int := 0; v_linea smallint; v_id uuid; v_nuevo boolean;
  v_creados int := 0; v_actualizados int := 0; v_precios int := 0;
  v_lista lista_precio; v_campo text; v_valor numeric;
begin
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
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
end $$;

-- ---------------------------------------------------------------------
-- Usuarios: el administrador crea la cuenta en Supabase Auth (correo y
-- contraseña) y desde GUVA le asigna nombre y rol.
-- ---------------------------------------------------------------------
create or replace function usuarios_sin_perfil()
returns table (id uuid, email text) language plpgsql stable security definer
set search_path = public, pg_temp as $$
begin
  perform exigir_rol('admin');
  return query select u.id, u.email::text from auth.users u
                where not exists (select 1 from perfiles p where p.id = u.id)
                order by u.email;
end $$;

create or replace function alta_perfil(p_usuario uuid, p_nombre text, p_rol rol_usuario,
                                       p_activo boolean default true)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := exigir_rol('admin');
begin
  if coalesce(trim(p_nombre), '') = '' then raise exception 'El nombre es obligatorio'; end if;
  if p_usuario = v_uid and (p_rol <> 'admin' or not p_activo) then
    raise exception 'No puede quitarse a sí mismo el rol de administrador';
  end if;
  insert into perfiles (id, nombre, rol, activo) values (p_usuario, trim(p_nombre), p_rol, p_activo)
  on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo;

  if p_rol = 'vendedor' then
    insert into ubicaciones (nombre, tipo, vendedor_id)
    values ('Ruta ' || trim(p_nombre), 'vendedor', p_usuario)
    on conflict (vendedor_id) do update set activo = p_activo;
  end if;
end $$;

grant execute on function
  importar_productos(jsonb, text),
  usuarios_sin_perfil(),
  alta_perfil(uuid, text, rol_usuario, boolean)
to authenticated;
