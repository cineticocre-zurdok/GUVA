import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { dinero, fecha } from '../../lib/formato';
import { NOMBRE_LISTA, type Linea, type ListaPrecio, type PrecioHistorial, type Producto } from '../../lib/tipos';
import { Aviso, Boton, Campo, Entrada, Panel, Selector } from '../../ui/ui';

const LISTAS: ListaPrecio[] = ['costo', 'mayoreo', 'detalle'];

type Form = Pick<Producto, 'codigo_interno' | 'nombre' | 'marca' | 'presentacion' | 'unidad_medida' | 'activo'> & {
  codigo_barras: string; linea_id: string; piezas_por_empaque: string; stock_minimo: string;
};

export function FichaProducto({ producto, lineas, precios, alCerrar, alGuardar }: {
  producto: Producto | null;
  lineas: Linea[];
  precios: Partial<Record<ListaPrecio, number>>;
  alCerrar: () => void;
  alGuardar: () => void;
}) {
  const [f, setF] = useState<Form>({
    codigo_interno: producto?.codigo_interno ?? '',
    codigo_barras: producto?.codigo_barras ?? '',
    nombre: producto?.nombre ?? '',
    marca: producto?.marca ?? '',
    linea_id: String(producto?.linea_id ?? lineas[0]?.id ?? ''),
    presentacion: producto?.presentacion ?? '',
    unidad_medida: producto?.unidad_medida ?? 'pieza',
    piezas_por_empaque: String(producto?.piezas_por_empaque ?? 1),
    stock_minimo: String(producto?.stock_minimo ?? 0),
    activo: producto?.activo ?? true
  });
  const [nuevos, setNuevos] = useState<Partial<Record<ListaPrecio, string>>>({});
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [guardando, setGuardando] = useState(false);
  // Id del producto ya guardado: si un precio falla después de crear el producto,
  // el siguiente intento actualiza en vez de intentar crearlo otra vez.
  const [idGuardado, setIdGuardado] = useState<string | null>(producto?.id ?? null);
  const cambia = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const historial = useConsulta(
    () => producto
      ? supabase.from('precios_historial').select('*').eq('producto_id', producto.id).order('vigente_desde', { ascending: false }).limit(20)
      : Promise.resolve({ data: [], error: null }),
    [producto?.id]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(''); setOk(''); setGuardando(true);
    try {
      const fila = {
        codigo_interno: f.codigo_interno.trim(),
        codigo_barras: f.codigo_barras.trim() || null,
        nombre: f.nombre.trim(),
        marca: f.marca.trim(),
        linea_id: Number(f.linea_id),
        presentacion: f.presentacion?.trim() || null,
        unidad_medida: f.unidad_medida.trim() || 'pieza',
        piezas_por_empaque: Number(f.piezas_por_empaque),
        stock_minimo: Number(f.stock_minimo),
        activo: f.activo
      };
      if (!Number.isInteger(fila.piezas_por_empaque) || fila.piezas_por_empaque < 1) throw new Error('Piezas por empaque debe ser un entero mayor a 0');
      if (!Number.isInteger(fila.stock_minimo) || fila.stock_minimo < 0) throw new Error('Stock mínimo debe ser un entero de 0 o más');

      // Se validan todos los precios ANTES de guardar, para no dejar el producto a medias
      const cambiosPrecio: { lista: ListaPrecio; precio: number }[] = [];
      for (const lista of LISTAS) {
        const v = nuevos[lista]?.trim();
        if (!v) continue;
        const precio = Number(v.replace(',', '.'));
        if (!Number.isFinite(precio) || precio < 0) throw new Error(`Precio de ${NOMBRE_LISTA[lista]} inválido`);
        if (precio !== precios[lista]) cambiosPrecio.push({ lista, precio });
      }

      const res = idGuardado
        ? await supabase.from('productos').update(fila).eq('id', idGuardado).select('id').single()
        : await supabase.from('productos').insert(fila).select('id').single();
      if (res.error) {
        if (res.error.code === '23505') throw new Error('Ya existe un producto con ese código interno o código de barras');
        throw res.error;
      }
      const id = res.data.id as string;
      setIdGuardado(id);

      // Precios: cada cambio queda en el historial con motivo
      const pendientes = { ...nuevos };
      for (const { lista, precio } of cambiosPrecio) {
        const { error } = await supabase.rpc('establecer_precio', {
          p_producto: id, p_lista: lista, p_precio: precio, p_motivo: motivo.trim() || null
        });
        if (error) {
          // Los precios que sí se guardaron se quitan del formulario para no duplicarlos al reintentar
          setNuevos(pendientes);
          alGuardar();
          throw new Error(`El producto se guardó, pero no se pudo registrar el precio de ${NOMBRE_LISTA[lista]}: ${mensajeError(error)}. Revisa y vuelve a guardar.`);
        }
        delete pendientes[lista];
      }
      setOk('Guardado.');
      setNuevos({});
      alGuardar();
      historial.recargar();
      if (!producto) alCerrar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Panel titulo={producto ? producto.nombre : 'Nuevo producto'} abierto alCerrar={alCerrar}>
      <form onSubmit={guardar} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Código interno"><Entrada required value={f.codigo_interno} onChange={cambia('codigo_interno')} /></Campo>
          <Campo etiqueta="Código de barras"><Entrada value={f.codigo_barras} onChange={cambia('codigo_barras')} inputMode="numeric" /></Campo>
        </div>
        <Campo etiqueta="Nombre comercial"><Entrada required value={f.nombre} onChange={cambia('nombre')} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Marca"><Entrada required value={f.marca} onChange={cambia('marca')} /></Campo>
          <Campo etiqueta="Línea">
            <Selector value={f.linea_id} onChange={cambia('linea_id')}>
              {lineas.map(l => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </Selector>
          </Campo>
          <Campo etiqueta="Presentación"><Entrada value={f.presentacion ?? ''} onChange={cambia('presentacion')} /></Campo>
          <Campo etiqueta="Unidad de medida"><Entrada value={f.unidad_medida} onChange={cambia('unidad_medida')} /></Campo>
          <Campo etiqueta="Piezas por empaque"><Entrada type="number" min={1} value={f.piezas_por_empaque} onChange={cambia('piezas_por_empaque')} /></Campo>
          <Campo etiqueta="Stock mínimo (piezas)"><Entrada type="number" min={0} value={f.stock_minimo} onChange={cambia('stock_minimo')} /></Campo>
        </div>
        {producto && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.activo} onChange={e => setF({ ...f, activo: e.target.checked })} /> Producto activo
          </label>
        )}

        <fieldset className="rounded-xl bg-cacao-50 p-3">
          <legend className="px-1 text-sm font-semibold">Precios por pieza</legend>
          <div className="grid grid-cols-3 gap-2">
            {LISTAS.map(l => (
              <Campo key={l} etiqueta={NOMBRE_LISTA[l]} ayuda={`Vigente: ${dinero(precios[l])}`}>
                <Entrada inputMode="decimal" placeholder="Sin cambio" value={nuevos[l] ?? ''} onChange={e => setNuevos({ ...nuevos, [l]: e.target.value })} />
              </Campo>
            ))}
          </div>
          <div className="mt-2">
            <Campo etiqueta="Motivo del cambio de precio" ayuda="Ej. Lista Ferrero de noviembre">
              <Entrada value={motivo} onChange={e => setMotivo(e.target.value)} />
            </Campo>
          </div>
        </fieldset>

        {error && <Aviso tipo="error">{error}</Aviso>}
        {ok && <Aviso tipo="exito">{ok}</Aviso>}
        <Boton type="submit" grande className="w-full" cargando={guardando}>Guardar</Boton>
      </form>

      {producto && ((historial.datos ?? []) as PrecioHistorial[]).length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Historial de precios</h3>
          <ul className="divide-y divide-cacao-100 text-sm">
            {((historial.datos ?? []) as PrecioHistorial[]).map(h => (
              <li key={h.id} className="flex justify-between gap-2 py-1.5">
                <span>{NOMBRE_LISTA[h.lista]} · <span className="text-cacao-600">{fecha(h.vigente_desde)}{h.motivo ? ` · ${h.motivo}` : ''}</span></span>
                <span className="num font-semibold">{dinero(h.precio)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
