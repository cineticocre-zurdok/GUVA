import { useState } from 'react';
import { useTieneRol } from '../../auth/Sesion';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { traerTodo } from '../../lib/traerTodo';
import { dinero, fecha, hoyMexico, piezas } from '../../lib/formato';
import { NOMBRE_METODO, type Pago, type Perfil, type Venta, type VentaDetalle } from '../../lib/tipos';
import { Aviso, Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Panel, Tabla, Tarjeta, Vacio } from '../../ui/ui';

// Sin costo_total: el vendedor no tiene permiso sobre esa columna
const COLUMNAS = 'id,folio,canal,cliente_id,vendedor_id,jornada_id,condicion,fecha_vencimiento,subtotal,descuento,total,estado,notas,registrada_en,sincronizada_en,motivo_cancelacion,clientes(nombre)';
type VentaLista = Venta & { clientes: { nombre: string } | null };
type Renglon = Omit<VentaDetalle, 'venta_id'> & { productos: { nombre: string } | null };

/** Rango [inicio, fin) del día en la hora del centro de México (UTC−6, sin horario de verano). */
function rangoDia(dia: string) {
  const inicio = new Date(`${dia}T00:00:00-06:00`);
  const fin = new Date(inicio.getTime() + 24 * 3600 * 1000);
  return [inicio.toISOString(), fin.toISOString()];
}

function DetalleVenta({ venta, vendedor, alCancelar }: { venta: VentaLista; vendedor?: string; alCancelar: () => void }) {
  const esAdmin = useTieneRol('admin');
  const det = useConsulta(async () => {
    const [d, p] = await Promise.all([
      supabase.from('venta_detalle').select('renglon,producto_id,cantidad,lista_aplicada,precio_unitario,descuento,importe,productos(nombre)')
        .eq('venta_id', venta.id).order('renglon'),
      supabase.from('pagos').select('id,folio,venta_id,metodo,monto,referencia,jornada_id,registrado_en,estado').eq('venta_id', venta.id).order('registrado_en')
    ]);
    if (d.error || p.error) return { data: null, error: d.error ?? p.error };
    return { data: { renglones: (d.data ?? []) as unknown as Renglon[], pagos: (p.data ?? []) as Pago[] }, error: null };
  }, [venta.id]);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function cancelar() {
    if (!motivo.trim()) return setError('El motivo es obligatorio.');
    if (!confirm(`¿Cancelar la venta ${venta.folio}? La mercancía regresa al inventario y sus cobros se cancelan.`)) return;
    setError(''); setEnviando(true);
    const { error } = await supabase.rpc('cancelar_venta', { p_venta: venta.id, p_motivo: motivo.trim() });
    setEnviando(false);
    if (error) return setError(mensajeError(error));
    alCancelar();
  }

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-y-1">
        <dt className="text-cacao-600">Cliente</dt><dd>{venta.clientes?.nombre ?? '—'}</dd>
        {vendedor && <><dt className="text-cacao-600">Vendedor</dt><dd>{vendedor}</dd></>}
        <dt className="text-cacao-600">Registrada</dt><dd>{fecha(venta.registrada_en)}</dd>
        <dt className="text-cacao-600">Condición</dt><dd>{venta.condicion === 'credito' ? `Crédito · vence ${venta.fecha_vencimiento}` : 'Contado'}</dd>
        <dt className="text-cacao-600">Estado</dt><dd>{venta.estado === 'cancelada' ? <Insignia tono="alerta">Cancelada</Insignia> : <Insignia tono="ok">Vigente</Insignia>}</dd>
      </dl>
      {venta.motivo_cancelacion && <Aviso tipo="alerta">Motivo de cancelación: {venta.motivo_cancelacion}</Aviso>}
      {det.cargando ? <Cargando /> : det.error ? <Aviso tipo="error">{det.error}</Aviso> : det.datos && (
        <>
          <ul className="divide-y divide-cacao-100">
            {det.datos.renglones.map(r => (
              <li key={r.renglon} className="flex justify-between gap-2 py-1.5">
                <span>{piezas(r.cantidad)} × {r.productos?.nombre ?? 'Producto'} @ {dinero(r.precio_unitario)}{r.descuento > 0 && ` − ${dinero(r.descuento)}`}</span>
                <span className="num">{dinero(r.importe)}</span>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-cacao-100 pt-2 text-base font-bold"><span>Total</span><span className="num">{dinero(venta.total)}</span></p>
          <div>
            <p className="mb-1 font-semibold">Cobros</p>
            {det.datos.pagos.length === 0 ? <p className="text-cacao-600">Sin cobros.</p> : (
              <ul className="divide-y divide-cacao-100">
                {det.datos.pagos.map(p => (
                  <li key={p.id} className="flex justify-between gap-2 py-1.5">
                    <span>{p.folio} · {NOMBRE_METODO[p.metodo]} · {fecha(p.registrado_en)} {p.estado === 'cancelada' && <Insignia tono="alerta">Cancelado</Insignia>}</span>
                    <span className="num">{dinero(p.monto)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {esAdmin && venta.estado === 'cerrada' && (
        <div className="space-y-2 border-t border-cacao-100 pt-3">
          <Campo etiqueta="Motivo de cancelación"><Entrada value={motivo} onChange={e => { setMotivo(e.target.value); setError(''); }} /></Campo>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <Boton variante="peligro" cargando={enviando} onClick={cancelar}>Cancelar venta</Boton>
          <p className="text-xs text-cacao-600">Si la jornada ya se cerró, no se cancela: registra una devolución de cliente.</p>
        </div>
      )}
    </div>
  );
}

export function Ventas() {
  const esAdmin = useTieneRol('admin');
  const [dia, setDia] = useState(hoyMexico());
  const [sel, setSel] = useState<VentaLista | null>(null);
  const ventas = useConsulta(() => {
    const [ini, fin] = rangoDia(dia);
    return traerTodo<VentaLista>(() => supabase.from('ventas').select(COLUMNAS)
      .gte('registrada_en', ini).lt('registrada_en', fin).order('registrada_en', { ascending: false }).order('id'));
  }, [dia]);
  // Nombres de vendedores: solo el administrador puede leer todos los perfiles
  const perfiles = useConsulta(async () => esAdmin
    ? await supabase.from('perfiles').select('id,nombre,rol,activo')
    : { data: [] as Perfil[], error: null }, [esAdmin]);
  const nombreVendedor = (id: string) => ((perfiles.datos ?? []) as Perfil[]).find(p => p.id === id)?.nombre;

  const lista = (ventas.datos ?? []) as VentaLista[];
  const vigentes = lista.filter(v => v.estado === 'cerrada');
  const total = vigentes.reduce((s, v) => s + Number(v.total), 0);
  const credito = vigentes.filter(v => v.condicion === 'credito').reduce((s, v) => s + Number(v.total), 0);

  return (
    <>
      <Encabezado titulo="Ventas" detalle={`${vigentes.length} vigentes · ${dinero(total)} · crédito ${dinero(credito)}`}
        acciones={<Entrada type="date" aria-label="Día" value={dia} onChange={e => setDia(e.target.value || hoyMexico())} className="w-44" />} />
      <Tarjeta>
        {ventas.error && <Aviso tipo="error">{ventas.error}</Aviso>}
        {ventas.cargando ? <Cargando /> : lista.length === 0 ? <Vacio>Sin ventas este día.</Vacio> : (
          <Tabla filas={lista} llave={v => v.id} alTocar={setSel} columnas={[
            { titulo: 'Folio', celda: v => <>{v.folio} {v.estado === 'cancelada' && <Insignia tono="alerta">Cancelada</Insignia>}</> },
            { titulo: 'Hora', celda: v => fecha(v.registrada_en) },
            { titulo: 'Cliente', celda: v => v.clientes?.nombre ?? '—' },
            ...(esAdmin ? [{ titulo: 'Vendedor', celda: (v: VentaLista) => nombreVendedor(v.vendedor_id) ?? '—', ocultarMovil: true }] : []),
            { titulo: 'Canal', celda: v => v.canal, ocultarMovil: true },
            { titulo: 'Condición', celda: v => v.condicion === 'credito' ? 'Crédito' : 'Contado', ocultarMovil: true },
            { titulo: 'Total', derecha: true, celda: v => <b className={v.estado === 'cancelada' ? 'line-through' : ''}>{dinero(v.total)}</b> }
          ]} />
        )}
      </Tarjeta>
      <Panel titulo={sel ? `Venta ${sel.folio}` : ''} abierto={!!sel} alCerrar={() => setSel(null)}>
        {sel && <DetalleVenta venta={sel} vendedor={esAdmin ? nombreVendedor(sel.vendedor_id) : undefined}
                              alCancelar={() => { setSel(null); ventas.recargar(); }} />}
      </Panel>
    </>
  );
}
