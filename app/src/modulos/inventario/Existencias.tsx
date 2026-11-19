import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTieneRol } from '../../auth/Sesion';
import { supabase } from '../../lib/supabase';
import { useConsulta } from '../../lib/useConsulta';
import { traerTodo } from '../../lib/traerTodo';
import { piezas } from '../../lib/formato';
import type { ExistenciaVista } from '../../lib/tipos';
import { Aviso, Cargando, Encabezado, Entrada, Insignia, Selector, Tabla, Tarjeta, Vacio } from '../../ui/ui';

export function Existencias() {
  const veMovimientos = useTieneRol('admin', 'bodega');
  const { datos, error, cargando } = useConsulta(() => traerTodo<ExistenciaVista>(() =>
    supabase.from('v_existencias').select('*').order('producto').order('ubicacion_id').order('producto_id')), []);
  const lista = (datos ?? []) as ExistenciaVista[];
  const ubicaciones = useMemo(() => [...new Map(lista.map(e => [e.ubicacion_id, e.ubicacion])).entries()], [lista]);
  const [ubic, setUbic] = useState('');
  const [texto, setTexto] = useState('');
  const [soloBajos, setSoloBajos] = useState(false);

  const ubicSel = ubic || ubicaciones.find(([, n]) => n === 'Bodega principal')?.[0] || ubicaciones[0]?.[0] || '';
  const filtrados = lista.filter(e =>
    e.ubicacion_id === ubicSel && (!soloBajos || e.bajo_minimo) &&
    (!texto || e.producto.toLowerCase().includes(texto.toLowerCase()) || e.codigo_interno.toLowerCase().includes(texto.toLowerCase())));
  const total = filtrados.reduce((s, e) => s + e.cantidad, 0);

  return (
    <>
      <Encabezado titulo="Inventario" detalle={`${piezas(total)} piezas · ${filtrados.length} productos`}
        acciones={veMovimientos && <>
          <Link to="/inventario/movimientos" className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-cacao-200">Movimientos</Link>
          <Link to="/inventario/entrada" className="inline-flex min-h-11 items-center rounded-xl bg-cacao-800 px-4 text-sm font-semibold text-white">Registrar entrada</Link>
        </>} />
      <Tarjeta>
        <div className="mb-3 grid gap-2 md:grid-cols-[220px_1fr_auto]">
          <Selector value={ubicSel} onChange={e => setUbic(e.target.value)} aria-label="Ubicación">
            {ubicaciones.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </Selector>
          <Entrada placeholder="Buscar producto" value={texto} onChange={e => setTexto(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={soloBajos} onChange={e => setSoloBajos(e.target.checked)} /> Bajo mínimo
          </label>
        </div>
        {error && <Aviso tipo="error">{error}</Aviso>}
        {cargando ? <Cargando /> : filtrados.length === 0 ? <Vacio>Sin existencias para mostrar.</Vacio> : (
          <Tabla filas={filtrados} llave={e => e.ubicacion_id + e.producto_id} columnas={[
            { titulo: 'Producto', celda: e => <>{e.producto} {e.bajo_minimo && <Insignia tono="alerta">Bajo mínimo</Insignia>}</> },
            { titulo: 'Código', celda: e => e.codigo_interno, ocultarMovil: true },
            { titulo: 'Línea', celda: e => e.linea, ocultarMovil: true },
            { titulo: 'Mínimo', derecha: true, celda: e => e.tipo_ubicacion === 'bodega' ? piezas(e.stock_minimo) : '—', ocultarMovil: true },
            { titulo: 'Existencia', derecha: true, celda: e => <b>{piezas(e.cantidad)}</b> }
          ]} />
        )}
      </Tarjeta>
    </>
  );
}
