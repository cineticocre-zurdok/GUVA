import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { encolar } from '../../lib/cola';
import { idDispositivo, nuevoId } from '../../lib/id';
import { dinero, piezas } from '../../lib/formato';
import { descuentoMaximo, disponibles, leerMonto, precioDe, redondear2, saldoConPendientes, totalesCarrito, type Ticket } from '../../lib/ruta';
import { NOMBRE_LISTA, NOMBRE_METODO, type MetodoPago, type Producto } from '../../lib/tipos';
import { Aviso, Boton, Campo, Encabezado, Entrada, Selector, Tarjeta, Vacio } from '../../ui/ui';
import { BuscadorProducto } from '../../ui/BuscadorProducto';
import { ConJornadaAbierta, useRuta } from './comun';

interface Linea { producto: Producto; cantidad: string; descuento: string }

function PuntoDeVenta() {
  const { datos, cola } = useRuta();
  const d = datos!;
  const navegar = useNavigate();
  const mostrador = d.clientes.find(c => c.tipo === 'mostrador');
  const [clienteId, setClienteId] = useState(mostrador?.id ?? d.clientes[0]?.id ?? '');
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [condicion, setCondicion] = useState<'contado' | 'credito'>('contado');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [recibido, setRecibido] = useState('');
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState('');

  const cliente = d.clientes.find(c => c.id === clienteId) ?? mostrador ?? null;
  const lista = cliente?.lista_precio ?? 'detalle';
  const pct = Number(d.config?.descuento_max_vendedor_pct ?? 0);
  const disp = useMemo(() => disponibles(d.existencias, cola.pendientes), [d.existencias, cola.pendientes]);
  const conExistencia = useMemo(() => d.productos.filter(p => (disp.get(p.id) ?? 0) > 0), [d.productos, disp]);

  const renglones = lineas.map(l => {
    const precio = precioDe(d.precios, l.producto.id, lista);
    const cantidad = parseInt(l.cantidad || '0', 10) || 0;
    const descuento = pct > 0 ? (leerMonto(l.descuento || '0') || 0) : 0;
    return { l, precio, cantidad, descuento, max: precio == null ? 0 : descuentoMaximo(cantidad, precio, pct), hay: disp.get(l.producto.id) ?? 0 };
  });
  const totales = totalesCarrito(renglones.map(r => ({ producto_id: r.l.producto.id, cantidad: r.cantidad, precio: r.precio ?? 0, descuento: r.descuento })));
  const recibidoNum = leerMonto(recibido);
  const cambio = metodo === 'efectivo' && !Number.isNaN(recibidoNum) ? redondear2(recibidoNum - totales.total) : null;

  const puedeCredito = !!cliente && cliente.permite_credito && cliente.dias_credito > 0;
  const saldoCliente = cliente
    ? redondear2(d.saldos.filter(s => s.cliente_id === cliente.id).reduce((s, x) => s + saldoConPendientes(x.venta_id, Number(x.saldo), cola.pendientes), 0)
      + cola.pendientes.filter(p => p.tipo === 'venta' && p.datos.cliente_id === cliente.id && p.datos.condicion === 'credito').reduce((s, p) => s + p.monto, 0))
    : 0;

  function agregar(p: Producto) {
    setError('');
    if (precioDe(d.precios, p.id, lista) == null) return setError(`"${p.nombre}" no tiene precio ${NOMBRE_LISTA[lista].toLowerCase()}. Avisa al administrador.`);
    if ((disp.get(p.id) ?? 0) <= 0) return setError(`No tienes "${p.nombre}" en tu inventario.`);
    setLineas(ls => ls.some(l => l.producto.id === p.id)
      ? ls.map(l => l.producto.id === p.id ? { ...l, cantidad: String((parseInt(l.cantidad || '0', 10) || 0) + 1) } : l)
      : [...ls, { producto: p, cantidad: '1', descuento: '' }]);
  }

  const cambiar = (id: string, k: 'cantidad' | 'descuento', v: string) =>
    setLineas(ls => ls.map(l => l.producto.id === id ? { ...l, [k]: k === 'cantidad' ? v.replace(/\D/g, '') : v.replace(/[^\d.]/g, '') } : l));
  const sumar = (id: string, n: number) =>
    setLineas(ls => ls.map(l => l.producto.id === id ? { ...l, cantidad: String(Math.max(1, (parseInt(l.cantidad || '0', 10) || 0) + n)) } : l));

  function registrar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!cliente) return setError('Elige un cliente.');
    if (renglones.length === 0) return setError('Agrega al menos un producto.');
    for (const r of renglones) {
      if (r.precio == null) return setError(`"${r.l.producto.nombre}" no tiene precio para la lista ${NOMBRE_LISTA[lista]}.`);
      if (r.cantidad <= 0) return setError(`Captura la cantidad de "${r.l.producto.nombre}".`);
      if (r.cantidad > r.hay) return setError(`Solo tienes ${piezas(r.hay)} de "${r.l.producto.nombre}".`);
      if (pct > 0 && Number.isNaN(leerMonto(r.l.descuento || '0'))) return setError(`Descuento inválido en "${r.l.producto.nombre}".`);
      if (r.descuento > r.max) return setError(`El descuento de "${r.l.producto.nombre}" excede el máximo (${dinero(r.max)}).`);
    }
    if (condicion === 'credito') {
      if (!puedeCredito) return setError(`"${cliente.nombre}" no tiene crédito autorizado.`);
      if (saldoCliente + totales.total > Number(cliente.limite_credito)) {
        return setError(`Se excede el límite de crédito: saldo ${dinero(saldoCliente)} + venta ${dinero(totales.total)} > límite ${dinero(cliente.limite_credito)}.`);
      }
    } else if (metodo === 'efectivo' && recibido && (Number.isNaN(recibidoNum) || recibidoNum < totales.total)) {
      return setError('El efectivo recibido es menor al total.');
    }

    const id = nuevoId();
    const ticket: Ticket = {
      cliente: cliente.nombre,
      renglones: renglones.map(r => ({ nombre: r.l.producto.nombre, cantidad: r.cantidad, precio: r.precio!, descuento: r.descuento,
                                       importe: redondear2(r.cantidad * r.precio! - r.descuento) })),
      total: totales.total, condicion,
      ...(condicion === 'contado' ? { metodo, referencia: referencia.trim() || undefined,
                                      recibido: metodo === 'efectivo' && !Number.isNaN(recibidoNum) ? recibidoNum : undefined } : {})
    };
    try {
      encolar({
        id, tipo: 'venta', monto: totales.total, ticket,
        resumen: `Venta ${condicion === 'credito' ? 'a crédito ' : ''}· ${cliente.nombre}`,
        piezas: renglones.map(r => ({ producto_id: r.l.producto.id, cantidad: r.cantidad })),
        datos: {
          id, canal: 'ruta', cliente_id: cliente.id, jornada_id: d.jornada!.id, condicion,
          registrada_en: new Date().toISOString(), dispositivo_id: idDispositivo(),
          renglones: renglones.map(r => ({ producto_id: r.l.producto.id, cantidad: r.cantidad, ...(r.descuento > 0 ? { descuento: r.descuento } : {}) })),
          ...(condicion === 'contado' ? { liquidar: { id: nuevoId(), metodo, referencia: referencia.trim() || null } } : {})
        }
      });
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err));
    }
    navegar(`/ruta/comprobante/${id}`);
  }

  return (
    <form onSubmit={registrar} className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Tarjeta className="space-y-3">
        <Campo etiqueta="Cliente" ayuda={cliente ? `Lista de precios: ${NOMBRE_LISTA[lista]}` : undefined}>
          <Selector value={clienteId} onChange={e => { setClienteId(e.target.value); setCondicion('contado'); setError(''); }}>
            {d.clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Selector>
        </Campo>
        <BuscadorProducto productos={conExistencia} alElegir={agregar}
          detalle={p => <>{dinero(precioDe(d.precios, p.id, lista))} · {piezas(disp.get(p.id) ?? 0)} pzas</>} />
        {renglones.length === 0 ? <Vacio>Busca o escanea los productos de la venta.</Vacio> : (
          <ul className="divide-y divide-cacao-100">
            {renglones.map(r => (
              <li key={r.l.producto.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{r.l.producto.nombre}</p>
                    <p className="text-xs text-cacao-600">{dinero(r.precio)} c/u · tienes {piezas(r.hay)}</p>
                  </div>
                  <button type="button" onClick={() => setLineas(ls => ls.filter(x => x !== r.l))}
                          className="rounded-lg px-2 py-1 text-sm text-red-700 hover:bg-red-50" aria-label={`Quitar ${r.l.producto.nombre}`}>Quitar</button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Boton type="button" variante="secundario" className="w-11" onClick={() => sumar(r.l.producto.id, -1)} aria-label="Una menos">−</Boton>
                  <Entrada className="w-20 text-center" inputMode="numeric" aria-label={`Cantidad de ${r.l.producto.nombre}`}
                           value={r.l.cantidad} onChange={e => cambiar(r.l.producto.id, 'cantidad', e.target.value)} />
                  <Boton type="button" variante="secundario" className="w-11" onClick={() => sumar(r.l.producto.id, 1)} aria-label="Una más">+</Boton>
                  {pct > 0 && (
                    <Entrada className="w-24" inputMode="decimal" placeholder="Desc. $" aria-label={`Descuento de ${r.l.producto.nombre}`}
                             value={r.l.descuento} onChange={e => cambiar(r.l.producto.id, 'descuento', e.target.value)} />
                  )}
                  <span className="num ml-auto font-bold">{dinero(r.precio == null ? null : r.cantidad * r.precio - r.descuento)}</span>
                </div>
                {r.cantidad > r.hay && <p className="mt-1 text-xs text-red-700">Solo tienes {piezas(r.hay)}.</p>}
                {pct > 0 && r.descuento > r.max && <p className="mt-1 text-xs text-red-700">Descuento máximo: {dinero(r.max)}.</p>}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta className="space-y-3 self-start">
        <div className="flex items-end justify-between">
          <span className="text-sm text-cacao-600">Total{totales.descuento > 0 && ` (desc. ${dinero(totales.descuento)})`}</span>
          <span className="num text-3xl font-bold">{dinero(totales.total)}</span>
        </div>

        {puedeCredito && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Condición de pago">
            {(['contado', 'credito'] as const).map(c => (
              <Boton key={c} type="button" variante={condicion === c ? 'primario' : 'secundario'} aria-pressed={condicion === c}
                     onClick={() => setCondicion(c)}>{c === 'contado' ? 'Contado' : 'Crédito'}</Boton>
            ))}
          </div>
        )}

        {condicion === 'credito' && cliente ? (
          <Aviso>Crédito a {cliente.dias_credito} días. Límite {dinero(cliente.limite_credito)} · saldo conocido {dinero(saldoCliente)}.</Aviso>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Forma de pago">
              {(['efectivo', 'transferencia'] as const).map(m => (
                <Boton key={m} type="button" variante={metodo === m ? 'primario' : 'secundario'} aria-pressed={metodo === m}
                       onClick={() => setMetodo(m)}>{NOMBRE_METODO[m]}</Boton>
              ))}
            </div>
            {metodo === 'efectivo' ? (
              <Campo etiqueta="Recibí (opcional, para calcular el cambio)">
                <Entrada inputMode="decimal" value={recibido} onChange={e => setRecibido(e.target.value)} />
              </Campo>
            ) : (
              <Campo etiqueta="Referencia de la transferencia (opcional)">
                <Entrada value={referencia} onChange={e => setReferencia(e.target.value)} />
              </Campo>
            )}
            {cambio != null && cambio >= 0 && <p className="text-right text-lg">Cambio: <b className="num">{dinero(cambio)}</b></p>}
          </>
        )}

        {error && <Aviso tipo="error">{error}</Aviso>}
        <Boton type="submit" grande className="w-full" disabled={renglones.length === 0}>
          {condicion === 'credito' ? 'Registrar venta a crédito' : 'Cobrar y registrar'}
        </Boton>
        <p className="text-xs text-cacao-600">Funciona sin señal: la venta se guarda en el teléfono y se envía sola. El precio final lo confirma el servidor.</p>
      </Tarjeta>
    </form>
  );
}

export function Vender() {
  return (
    <>
      <Encabezado titulo="Nueva venta" />
      <ConJornadaAbierta><PuntoDeVenta /></ConJornadaAbierta>
    </>
  );
}
