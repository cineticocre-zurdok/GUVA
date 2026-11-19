import { useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useConsulta } from '../../lib/useConsulta';
import { traerTodo } from '../../lib/traerTodo';
import { fecha, piezas } from '../../lib/formato';
import { NOMBRE_MOVIMIENTO, type Movimiento, type Producto, type Ubicacion } from '../../lib/tipos';
import { Aviso, Cargando, Encabezado, Tabla, Tarjeta, Vacio } from '../../ui/ui';

export function Movimientos() {
  const movs = useConsulta(() => supabase.from('movimientos_inventario')
    .select('id,creado_en,producto_id,cantidad,tipo,origen_id,destino_id,usuario_id,motivo,referencia_tipo')
    .order('id', { ascending: false }).limit(200), []);
  const prods = useConsulta(() => traerTodo(() => supabase.from('productos').select('id,nombre').order('id')), []);
  const ubics = useConsulta(() => supabase.from('ubicaciones').select('id,nombre'), []);
  const perfiles = useConsulta(() => supabase.from('perfiles').select('id,nombre'), []);

  const nombre = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of [...(prods.datos ?? []), ...(ubics.datos ?? []), ...(perfiles.datos ?? [])] as (Pick<Producto, 'id' | 'nombre'> | Pick<Ubicacion, 'id' | 'nombre'>)[]) m.set(x.id, x.nombre);
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [prods.datos, ubics.datos, perfiles.datos]);

  const lista = (movs.datos ?? []) as Movimiento[];
  return (
    <>
      <Encabezado titulo="Movimientos de inventario" detalle="Últimos 200 · no se editan ni se borran" />
      <Tarjeta>
        {movs.error && <Aviso tipo="error">{movs.error}</Aviso>}
        {movs.cargando ? <Cargando /> : lista.length === 0 ? <Vacio>Aún no hay movimientos.</Vacio> : (
          <Tabla filas={lista} llave={m => String(m.id)} columnas={[
            { titulo: 'Producto', celda: m => nombre(m.producto_id) },
            { titulo: 'Tipo', celda: m => NOMBRE_MOVIMIENTO[m.tipo] ?? m.tipo },
            { titulo: 'Cantidad', derecha: true, celda: m => piezas(m.cantidad) },
            { titulo: 'De → A', celda: m => `${nombre(m.origen_id)} → ${nombre(m.destino_id)}` },
            { titulo: 'Usuario', celda: m => nombre(m.usuario_id), ocultarMovil: true },
            { titulo: 'Motivo', celda: m => m.motivo ?? '—', ocultarMovil: true },
            { titulo: 'Fecha', celda: m => fecha(m.creado_en) }
          ]} />
        )}
      </Tarjeta>
    </>
  );
}
