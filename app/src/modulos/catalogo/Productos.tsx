import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTieneRol } from '../../auth/Sesion';
import { supabase } from '../../lib/supabase';
import { useConsulta } from '../../lib/useConsulta';
import { traerTodo } from '../../lib/traerTodo';
import { dinero } from '../../lib/formato';
import type { Linea, ListaPrecio, PrecioVigente, Producto } from '../../lib/tipos';
import { Aviso, Boton, Cargando, Encabezado, Entrada, Insignia, Selector, Tabla, Tarjeta, Vacio } from '../../ui/ui';
import { FichaProducto } from './FichaProducto';

export type MapaPrecios = Map<string, Partial<Record<ListaPrecio, number>>>;

export function Productos() {
  const esAdmin = useTieneRol('admin');
  const [texto, setTexto] = useState('');
  const [linea, setLinea] = useState('');
  const [verInactivos, setVerInactivos] = useState(false);
  const [abierto, setAbierto] = useState<Producto | 'nuevo' | null>(null);

  const prods = useConsulta(() => traerTodo<Producto>(() => supabase.from('productos').select('*').order('nombre').order('id')), []);
  const lineas = useConsulta(() => supabase.from('lineas').select('*').order('id'), []);
  const precios = useConsulta(() => traerTodo<PrecioVigente>(() => supabase.from('v_precios_vigentes').select('*').order('producto_id').order('lista')), []);

  const mapaPrecios: MapaPrecios = useMemo(() => {
    const m: MapaPrecios = new Map();
    for (const p of (precios.datos ?? []) as PrecioVigente[]) {
      m.set(p.producto_id, { ...m.get(p.producto_id), [p.lista]: Number(p.precio) });
    }
    return m;
  }, [precios.datos]);

  const listaLineas = (lineas.datos ?? []) as Linea[];
  const nombreLinea = (id: number) => listaLineas.find(l => l.id === id)?.nombre ?? '';

  const filtrados = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return ((prods.datos ?? []) as Producto[]).filter(p =>
      (verInactivos || p.activo) &&
      (!linea || String(p.linea_id) === linea) &&
      (!q || p.nombre.toLowerCase().includes(q) || p.codigo_interno.toLowerCase().includes(q) || (p.codigo_barras ?? '').includes(q)));
  }, [prods.datos, texto, linea, verInactivos]);

  const recargar = () => { prods.recargar(); precios.recargar(); };

  return (
    <>
      <Encabezado
        titulo="Catálogo"
        detalle={`${filtrados.length} productos`}
        acciones={esAdmin && <>
          <Link to="/catalogo/importar" className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-cacao-200">Importar CSV</Link>
          <Boton onClick={() => setAbierto('nuevo')}>Nuevo producto</Boton>
        </>}
      />
      <Tarjeta>
        <div className="mb-3 grid gap-2 md:grid-cols-[1fr_200px_auto]">
          <Entrada placeholder="Buscar por nombre, código o código de barras" value={texto} onChange={e => setTexto(e.target.value)} inputMode="search" />
          <Selector value={linea} onChange={e => setLinea(e.target.value)} aria-label="Línea">
            <option value="">Todas las líneas</option>
            {listaLineas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </Selector>
          {esAdmin && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} /> Inactivos
            </label>
          )}
        </div>
        {prods.error && <Aviso tipo="error">{prods.error}</Aviso>}
        {prods.cargando ? <Cargando /> : filtrados.length === 0 ? (
          <Vacio>{(prods.datos as Producto[] | null)?.length ? 'Ningún producto coincide con la búsqueda.' : 'El catálogo está vacío. Importa la lista de productos o agrégalos uno por uno.'}</Vacio>
        ) : (
          <Tabla
            filas={filtrados}
            llave={p => p.id}
            alTocar={esAdmin ? p => setAbierto(p) : undefined}
            columnas={[
              { titulo: 'Producto', celda: p => (
                <span>
                  {p.nombre} {p.presentacion && <span className="text-cacao-600">· {p.presentacion}</span>}{' '}
                  {p.es_demo && <Insignia tono="demo">DEMO</Insignia>} {!p.activo && <Insignia tono="alerta">Inactivo</Insignia>}
                </span>) },
              { titulo: 'Código', celda: p => p.codigo_interno },
              { titulo: 'Línea', celda: p => nombreLinea(p.linea_id), ocultarMovil: true },
              ...(esAdmin ? [{ titulo: 'Costo', derecha: true, celda: (p: Producto) => dinero(mapaPrecios.get(p.id)?.costo) }] : []),
              { titulo: 'Mayoreo', derecha: true, celda: p => dinero(mapaPrecios.get(p.id)?.mayoreo) },
              { titulo: 'Detalle', derecha: true, celda: p => dinero(mapaPrecios.get(p.id)?.detalle) }
            ]}
          />
        )}
      </Tarjeta>
      {abierto && (
        <FichaProducto
          producto={abierto === 'nuevo' ? null : abierto}
          lineas={listaLineas}
          precios={abierto === 'nuevo' ? {} : mapaPrecios.get(abierto.id) ?? {}}
          alCerrar={() => setAbierto(null)}
          alGuardar={recargar}
        />
      )}
    </>
  );
}
