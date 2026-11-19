import { Link, useParams } from 'react-router-dom';
import { dinero, fecha } from '../../lib/formato';
import { NOMBRE_METODO } from '../../lib/tipos';
import type { Ticket } from '../../lib/ruta';
import { Aviso, Boton, Insignia, Tarjeta } from '../../ui/ui';
import { enlaceBoton, useRuta } from './comun';

function textoTicket(nombre: string, folio: string, cuando: string, t: Ticket, total: number, leyenda: string) {
  const l = [
    nombre, `Folio: ${folio}`, cuando, `Cliente: ${t.cliente}`, '',
    ...t.renglones.map(r => `${r.cantidad} x ${r.nombre} @ ${dinero(r.precio)}${r.descuento ? ` (desc. ${dinero(r.descuento)})` : ''} = ${dinero(r.importe)}`),
    '', `TOTAL: ${dinero(total)}`,
    t.condicion === 'credito' ? 'Venta a crédito' : `Pago: ${t.metodo ? NOMBRE_METODO[t.metodo] : ''}`,
    '', leyenda
  ];
  return l.join('\n');
}

export function Comprobante() {
  const { id } = useParams();
  const { datos, cola } = useRuta();
  const pendiente = cola.pendientes.find(p => p.id === id);
  const enviado = cola.enviados.find(e => e.id === id);
  const t = pendiente?.ticket ?? enviado?.ticket;
  const c = datos?.config;

  if (!t) {
    return (
      <Aviso tipo="alerta">
        Este comprobante ya no está en el teléfono. Consulta la venta en <Link to="/ventas" className="font-semibold underline">Ventas</Link>.
      </Aviso>
    );
  }

  const folio = enviado?.folio ?? 'Pendiente de folio';
  const total = enviado?.total ?? t.total;
  const cuando = fecha(pendiente?.creado ?? enviado?.creado);
  const nombre = c?.nombre_comercial ?? 'GUVA';
  const leyenda = c?.leyenda_comprobante ?? 'Comprobante interno de operación. No es un CFDI ni tiene validez fiscal.';
  const cambio = t.recibido != null ? t.recibido - total : null;

  function compartir() {
    const texto = textoTicket(nombre, folio, cuando, t!, total, leyenda);
    if (typeof navigator.share === 'function') navigator.share({ text: texto }).catch(() => { /* cancelado */ });
    else window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      {pendiente?.error && <Aviso tipo="error">El servidor rechazó esta venta: {pendiente.error}. Revísala en Mi ruta.</Aviso>}
      {pendiente && !pendiente.error && <Aviso tipo="alerta">Venta guardada en el teléfono. Se enviará sola cuando haya señal y entonces recibirá su folio.</Aviso>}
      {enviado && enviado.total != null && enviado.total !== t.total && (
        <Aviso tipo="alerta">El servidor registró un total de {dinero(enviado.total)} (estimado en el teléfono: {dinero(t.total)}) porque cambió un precio. Cobra la diferencia o avisa al administrador.</Aviso>
      )}

      <Tarjeta className="comprobante font-mono text-sm">
        <div className="text-center">
          <p className="text-base font-bold">{nombre}</p>
          {c && c.razon_social !== 'POR CONFIGURAR' && <p>{c.razon_social}</p>}
          {c && c.rfc !== 'POR CONFIGURAR' && <p>RFC {c.rfc}</p>}
          {c && c.direccion !== 'POR CONFIGURAR' && <p>{c.direccion}</p>}
          {c && c.telefono !== 'POR CONFIGURAR' && <p>Tel. {c.telefono}</p>}
        </div>
        <div className="my-3 border-y border-dashed border-cacao-400 py-2">
          <p className="flex justify-between"><span>Folio</span><b>{folio}</b></p>
          <p className="flex justify-between"><span>Fecha</span><span>{cuando}</span></p>
          <p className="flex justify-between"><span>Cliente</span><span>{t.cliente}</span></p>
        </div>
        <ul className="space-y-1">
          {t.renglones.map((r, i) => (
            <li key={i}>
              <p>{r.nombre}</p>
              <p className="flex justify-between"><span>{r.cantidad} x {dinero(r.precio)}{r.descuento > 0 && ` − ${dinero(r.descuento)}`}</span><span>{dinero(r.importe)}</span></p>
            </li>
          ))}
        </ul>
        <div className="mt-3 border-t border-dashed border-cacao-400 pt-2">
          <p className="flex justify-between text-base font-bold"><span>TOTAL</span><span>{dinero(total)}</span></p>
          {t.condicion === 'credito'
            ? <p>Venta a crédito</p>
            : <p className="flex justify-between"><span>{t.metodo ? NOMBRE_METODO[t.metodo] : 'Pago'}</span><span>{dinero(t.recibido ?? total)}</span></p>}
          {cambio != null && cambio > 0 && <p className="flex justify-between"><span>Cambio</span><span>{dinero(cambio)}</span></p>}
          {t.referencia && <p>Ref. {t.referencia}</p>}
        </div>
        <p className="mt-3 text-center text-xs">{leyenda}</p>
        <p className="mt-2 text-center">{enviado ? <Insignia tono="ok">Registrada</Insignia> : <Insignia tono="alerta">Pendiente de envío</Insignia>}</p>
      </Tarjeta>

      <div className="no-imprimir grid grid-cols-2 gap-2">
        <Boton variante="secundario" onClick={() => window.print()}>Imprimir</Boton>
        <Boton variante="secundario" onClick={compartir}>Compartir</Boton>
        <Link to="/ruta/vender" className={`${enlaceBoton} bg-cacao-800 text-white`}>Nueva venta</Link>
        <Link to="/ruta" className={`${enlaceBoton} bg-white ring-1 ring-cacao-200`}>Mi ruta</Link>
      </div>
    </div>
  );
}
