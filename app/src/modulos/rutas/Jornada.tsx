import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTieneRol } from '../../auth/Sesion';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { traerTodo } from '../../lib/traerTodo';
import { dinero, fecha, piezas } from '../../lib/formato';
import {
  NOMBRE_CARGA, NOMBRE_JORNADA,
  type Carga, type CargaDetalle, type CierreDetalle, type CierreRuta, type ExistenciaVista, type Gasto, type Pago, type Producto, type Venta
} from '../../lib/tipos';
import { Aviso, Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Panel, Tabla, Tarjeta, Vacio } from '../../ui/ui';
import { BuscadorProducto } from '../../ui/BuscadorProducto';
import type { JornadaConRuta } from './Rutas';

type CargaConDetalle = Carga & { carga_detalle: Pick<CargaDetalle, 'producto_id' | 'cantidad'>[] };
interface Renglon { producto: Producto; cajas: string; sueltas: string }
const totalPiezas = (r: Renglon) =>
  (parseInt(r.cajas || '0', 10) || 0) * r.producto.piezas_por_empaque + (parseInt(r.sueltas || '0', 10) || 0);

function NuevaCarga({ jornadaId, tipo, productos, bodega, alTerminar }: {
  jornadaId: string; tipo: 'inicial' | 'adicional'; productos: Producto[]; bodega: Map<string, number>; alTerminar: (aviso?: string) => void;
}) {
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const disponibles = useMemo(() => productos.filter(p => p.activo && (bodega.get(p.id) ?? 0) > 0), [productos, bodega]);

  const agregar = (p: Producto) =>
    setRenglones(rs => rs.some(r => r.producto.id === p.id) ? rs : [...rs, { producto: p, cajas: '', sueltas: '' }]);
  const cambia = (id: string, k: 'cajas' | 'sueltas', v: string) =>
    setRenglones(rs => rs.map(r => r.producto.id === id ? { ...r, [k]: v.replace(/\D/g, '') } : r));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (renglones.length === 0) return setError('Agrega al menos un producto.');
    for (const r of renglones) {
      const n = totalPiezas(r);
      if (n <= 0) return setError(`Captura la cantidad de "${r.producto.nombre}".`);
      if (n > (bodega.get(r.producto.id) ?? 0)) return setError(`En bodega solo hay ${piezas(bodega.get(r.producto.id) ?? 0)} de "${r.producto.nombre}".`);
    }
    setEnviando(true);
    const { data: carga, error } = await supabase.rpc('crear_carga', {
      p_jornada: jornadaId, p_tipo: tipo, p_notas: notas.trim() || null,
      p_renglones: renglones.map(r => ({ producto_id: r.producto.id, cantidad: totalPiezas(r) }))
    });
    if (error) { setEnviando(false); return setError(mensajeError(error)); }
    const desp = await supabase.rpc('despachar_carga', { p_carga: carga as string });
    setEnviando(false);
    // La carga ya existe: se cierra el panel para no crearla dos veces
    alTerminar(desp.error ? `La carga se guardó pero no se despachó: ${mensajeError(desp.error)}. Despáchala desde la lista.` : undefined);
  }

  return (
    <form onSubmit={guardar} className="space-y-3">
      <BuscadorProducto productos={disponibles} alElegir={agregar} autoFocus detalle={p => `${piezas(bodega.get(p.id) ?? 0)} en bodega`} />
      {renglones.length === 0 ? <Vacio>Agrega los productos que salen a ruta.</Vacio> : (
        <ul className="divide-y divide-cacao-100">
          {renglones.map(r => (
            <li key={r.producto.id} className="grid grid-cols-[1fr_90px_90px_auto] items-end gap-2 py-2">
              <div>
                <p className="font-semibold">{r.producto.nombre}</p>
                <p className="text-xs text-cacao-600">{r.producto.piezas_por_empaque} pzas/empaque · bodega {piezas(bodega.get(r.producto.id) ?? 0)}</p>
                <p className="num text-sm font-bold">{piezas(totalPiezas(r))} pzas</p>
              </div>
              <Campo etiqueta="Empaques"><Entrada inputMode="numeric" value={r.cajas} onChange={e => cambia(r.producto.id, 'cajas', e.target.value)} /></Campo>
              <Campo etiqueta="Sueltas"><Entrada inputMode="numeric" value={r.sueltas} onChange={e => cambia(r.producto.id, 'sueltas', e.target.value)} /></Campo>
              <button type="button" onClick={() => setRenglones(rs => rs.filter(x => x !== r))}
                      className="mb-2 rounded-lg px-2 py-1 text-sm text-red-700 hover:bg-red-50" aria-label={`Quitar ${r.producto.nombre}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <Campo etiqueta="Notas (opcional)"><Entrada value={notas} onChange={e => setNotas(e.target.value)} /></Campo>
      <p className="text-right text-sm font-semibold">{piezas(renglones.reduce((s, r) => s + totalPiezas(r), 0))} piezas</p>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <Boton type="submit" grande className="w-full" cargando={enviando}>Guardar y despachar</Boton>
      <p className="text-xs text-cacao-600">Al despachar, la mercancía sale de bodega y pasa al inventario del vendedor, que la confirma en su teléfono.</p>
    </form>
  );
}

function ResumenDinero({ jornadaId }: { jornadaId: string }) {
  const r = useConsulta(async () => {
    const [v, p, g] = await Promise.all([
      supabase.from('ventas').select('total,condicion').eq('jornada_id', jornadaId).eq('estado', 'cerrada'),
      supabase.from('pagos').select('monto,metodo').eq('jornada_id', jornadaId).eq('estado', 'cerrada'),
      supabase.from('gastos').select('monto,metodo').eq('jornada_id', jornadaId).eq('estado', 'cerrada')
    ]);
    const error = v.error ?? p.error ?? g.error;
    if (error) return { data: null, error };
    return { data: {
      ventas: (v.data ?? []) as Pick<Venta, 'total' | 'condicion'>[],
      pagos: (p.data ?? []) as Pick<Pago, 'monto' | 'metodo'>[],
      gastos: (g.data ?? []) as Pick<Gasto, 'monto' | 'metodo'>[]
    }, error: null };
  }, [jornadaId]);
  if (r.error) return <Aviso tipo="error">{r.error}</Aviso>;
  if (!r.datos) return null;
  const { ventas, pagos, gastos } = r.datos;
  const s = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const efe = s(pagos.filter(x => x.metodo === 'efectivo'), x => Number(x.monto));
  const gEfe = s(gastos.filter(x => x.metodo === 'efectivo'), x => Number(x.monto));
  return (
    <Tarjeta>
      <h2 className="mb-2 font-bold">Dinero de la jornada</h2>
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt>Ventas ({ventas.length})</dt><dd className="num text-right font-semibold">{dinero(s(ventas, x => Number(x.total)))}</dd>
        <dt>A crédito</dt><dd className="num text-right">{dinero(s(ventas.filter(x => x.condicion === 'credito'), x => Number(x.total)))}</dd>
        <dt>Cobrado en efectivo</dt><dd className="num text-right">{dinero(efe)}</dd>
        <dt>Cobrado por transferencia</dt><dd className="num text-right">{dinero(s(pagos.filter(x => x.metodo !== 'efectivo'), x => Number(x.monto)))}</dd>
        <dt>Gastos en efectivo</dt><dd className="num text-right">−{dinero(gEfe)}</dd>
        <dt className="font-semibold">Efectivo esperado</dt><dd className="num text-right font-bold">{dinero(efe - gEfe)}</dd>
      </dl>
    </Tarjeta>
  );
}

function RevisionCierre({ jornadaId, nombres, alRevisar }: { jornadaId: string; nombres: Map<string, string>; alRevisar: () => void }) {
  const esAdmin = useTieneRol('admin');
  const cierre = useConsulta(async () => {
    const c = await supabase.from('cierres_ruta').select('*').eq('jornada_id', jornadaId).maybeSingle();
    if (c.error || !c.data) return { data: null, error: c.error };
    const d = await supabase.from('cierre_detalle').select('*').eq('cierre_id', (c.data as CierreRuta).id).order('diferencia');
    if (d.error) return { data: null, error: d.error };
    return { data: { cierre: c.data as CierreRuta, detalle: (d.data ?? []) as CierreDetalle[] }, error: null };
  }, [jornadaId]);
  const [obs, setObs] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (cierre.error) return <Aviso tipo="error">{cierre.error}</Aviso>;
  if (!cierre.datos) return null;
  const { cierre: c, detalle } = cierre.datos;
  const conDif = detalle.filter(d => d.diferencia !== 0);

  async function revisar() {
    if (!confirm(conDif.length ? `Se registrarán ${conDif.length} ajuste(s) de inventario por las diferencias. ¿Cerrar la jornada?` : '¿Aprobar el cierre y cerrar la jornada?')) return;
    setError(''); setEnviando(true);
    const { error } = await supabase.rpc('revisar_cierre', { p_cierre: c.id, p_observaciones: obs.trim() || null });
    setEnviando(false);
    if (error) return setError(mensajeError(error));
    cierre.recargar(); alRevisar();
  }

  return (
    <Tarjeta>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">Cierre {c.folio}</h2>
        {c.revisado_en ? <Insignia tono="ok">Revisado {fecha(c.revisado_en)}</Insignia> : <Insignia tono="alerta">Por revisar</Insignia>}
      </div>
      <dl className="mb-3 grid grid-cols-2 gap-y-1 text-sm md:grid-cols-4">
        <dt>Ventas</dt><dd className="num font-semibold">{dinero(c.ventas_total)}</dd>
        <dt>A crédito</dt><dd className="num">{dinero(c.ventas_credito)}</dd>
        <dt>Efectivo esperado</dt><dd className="num">{dinero(c.efectivo_esperado)}</dd>
        <dt>Efectivo entregado</dt><dd className="num">{dinero(c.efectivo_entregado)}</dd>
        <dt>Transferencias</dt><dd className="num">{dinero(c.cobrado_transferencia)}</dd>
        <dt>Diferencia de efectivo</dt>
        <dd className={`num font-bold ${c.diferencia_efectivo < 0 ? 'text-red-700' : c.diferencia_efectivo > 0 ? 'text-amber-700' : 'text-green-700'}`}>{dinero(c.diferencia_efectivo)}</dd>
        <dt>Piezas con diferencia</dt><dd className="num font-bold">{piezas(c.piezas_diferencia)}</dd>
      </dl>
      {c.observaciones && <p className="mb-3 text-sm"><b>Observaciones:</b> {c.observaciones}</p>}
      <Tabla filas={detalle} llave={d => d.producto_id} columnas={[
        { titulo: 'Producto', celda: d => nombres.get(d.producto_id) ?? 'Producto' },
        { titulo: 'Inicial', derecha: true, celda: d => piezas(d.inicial), ocultarMovil: true },
        { titulo: 'Adicional', derecha: true, celda: d => piezas(d.adicional), ocultarMovil: true },
        { titulo: 'Vendido', derecha: true, celda: d => piezas(d.vendido), ocultarMovil: true },
        { titulo: 'Devuelto/merma', derecha: true, celda: d => piezas(d.devuelto + d.merma), ocultarMovil: true },
        { titulo: 'Teórico', derecha: true, celda: d => piezas(d.final_teorico) },
        { titulo: 'Contado', derecha: true, celda: d => piezas(d.final_contado) },
        { titulo: 'Diferencia', derecha: true, celda: d => <b className={d.diferencia < 0 ? 'text-red-700' : d.diferencia > 0 ? 'text-amber-700' : ''}>{piezas(d.diferencia)}</b> }
      ]} />
      {esAdmin && !c.revisado_en && (
        <div className="mt-4 space-y-2 border-t border-cacao-100 pt-3">
          <Campo etiqueta="Observaciones de la revisión (opcional)"><Entrada value={obs} onChange={e => setObs(e.target.value)} /></Campo>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <Boton cargando={enviando} onClick={revisar}>Aprobar y cerrar jornada</Boton>
          <p className="text-xs text-cacao-600">Las diferencias de mercancía se registran como ajustes trazables en el inventario del vendedor. La diferencia de efectivo queda en el cierre.</p>
        </div>
      )}
    </Tarjeta>
  );
}

export function DetalleJornada() {
  const { id = '' } = useParams();
  const esAdmin = useTieneRol('admin');
  const jornada = useConsulta(() => supabase.from('jornadas_ruta').select('*, ubicaciones(nombre)').eq('id', id).maybeSingle(), [id]);
  const cargas = useConsulta(() => supabase.from('cargas').select('*, carga_detalle(producto_id,cantidad)').eq('jornada_id', id).order('creado_en'), [id]);
  const productos = useConsulta(() => traerTodo<Producto>(() => supabase.from('productos').select('*').order('nombre').order('id')), []);
  const bodega = useConsulta(() => traerTodo<ExistenciaVista>(() => supabase.from('v_existencias').select('*').eq('tipo_ubicacion', 'bodega')
    .order('producto_id').order('ubicacion_id')), []);
  const [nueva, setNueva] = useState(false);
  const [error, setError] = useState('');
  const [despachando, setDespachando] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);

  const j = jornada.datos as JornadaConRuta | null;
  const lista = (cargas.datos ?? []) as CargaConDetalle[];
  const prods = (productos.datos ?? []) as Producto[];
  const nombres = useMemo(() => new Map(prods.map(p => [p.id, p.nombre])), [prods]);
  const stock = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of (bodega.datos ?? []) as ExistenciaVista[]) m.set(e.producto_id, (m.get(e.producto_id) ?? 0) + e.cantidad);
    return m;
  }, [bodega.datos]);

  if (jornada.cargando) return <Cargando />;
  if (jornada.error) return <Aviso tipo="error">{jornada.error}</Aviso>;
  if (!j) return <Aviso tipo="alerta">Jornada no encontrada. <Link to="/rutas" className="underline">Volver</Link></Aviso>;

  const admiteCargas = j.estado === 'preparacion' || j.estado === 'abierta';
  const tipoNueva = lista.some(c => c.estado !== 'cancelada') ? 'adicional' : 'inicial';

  async function despachar(cargaId: string) {
    setError(''); setDespachando(cargaId);
    const { error } = await supabase.rpc('despachar_carga', { p_carga: cargaId });
    setDespachando('');
    if (error) return setError(mensajeError(error));
    cargas.recargar(); bodega.recargar();
  }

  return (
    <>
      <Encabezado titulo={j.ubicaciones?.nombre ?? 'Jornada'} detalle={`Jornada del ${j.fecha} · ${NOMBRE_JORNADA[j.estado]}`}
        acciones={<>
          <Link to="/rutas" className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-semibold ring-1 ring-cacao-200">Todas las rutas</Link>
          {admiteCargas && <Boton onClick={() => setNueva(true)}>Nueva carga {tipoNueva}</Boton>}
        </>} />
      {error && <div className="mb-3"><Aviso tipo="error">{error}</Aviso></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta>
          <h2 className="mb-2 font-bold">Cargas</h2>
          {cargas.cargando ? <Cargando /> : lista.length === 0 ? <Vacio>Sin cargas. Prepara la carga inicial.</Vacio> : (
            <ul className="divide-y divide-cacao-100">
              {lista.map(c => (
                <li key={c.id} className="py-2">
                  <button className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setAbierta(abierta === c.id ? null : c.id)}>
                    <span>
                      <span className="font-semibold">{c.folio ?? 'Sin folio'}</span> · {c.tipo}
                      <span className="block text-xs text-cacao-600">{piezas(c.carga_detalle.reduce((s, d) => s + d.cantidad, 0))} pzas · {c.carga_detalle.length} productos</span>
                    </span>
                    <Insignia tono={c.estado === 'recibida' ? 'ok' : c.estado === 'cancelada' ? 'neutro' : 'alerta'}>{NOMBRE_CARGA[c.estado]}</Insignia>
                  </button>
                  {abierta === c.id && (
                    <ul className="mt-2 rounded-xl bg-cacao-50 p-2 text-sm">
                      {c.carga_detalle.map(d => (
                        <li key={d.producto_id} className="flex justify-between py-0.5"><span>{nombres.get(d.producto_id) ?? 'Producto'}</span><b className="num">{piezas(d.cantidad)}</b></li>
                      ))}
                    </ul>
                  )}
                  {c.estado === 'preparando' && (
                    <Boton className="mt-2" variante="secundario" cargando={despachando === c.id} onClick={() => despachar(c.id)}>Despachar</Boton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
        {esAdmin && <ResumenDinero jornadaId={j.id} />}
      </div>

      {(j.estado === 'en_cierre' || j.estado === 'cerrada') && (
        <div className="mt-4"><RevisionCierre jornadaId={j.id} nombres={nombres} alRevisar={jornada.recargar} /></div>
      )}

      <Panel titulo={`Nueva carga ${tipoNueva}`} abierto={nueva} alCerrar={() => setNueva(false)}>
        {productos.cargando || bodega.cargando ? <Cargando /> : (
          <NuevaCarga jornadaId={j.id} tipo={tipoNueva} productos={prods} bodega={stock}
            alTerminar={aviso => { setNueva(false); setError(aviso ?? ''); cargas.recargar(); bodega.recargar(); }} />
        )}
      </Panel>
    </>
  );
}
