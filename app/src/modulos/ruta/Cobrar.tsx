import { useState, type FormEvent } from 'react';
import { encolar } from '../../lib/cola';
import { nuevoId } from '../../lib/id';
import { dinero } from '../../lib/formato';
import { leerMonto, saldoConPendientes } from '../../lib/ruta';
import { NOMBRE_METODO, type MetodoPago, type SaldoVenta } from '../../lib/tipos';
import { Aviso, Boton, Campo, Encabezado, Entrada, Insignia, Panel, Tarjeta, Vacio } from '../../ui/ui';
import { ConJornadaAbierta, useRuta } from './comun';

function ListaSaldos() {
  const { datos, cola } = useRuta();
  const d = datos!;
  const [venta, setVenta] = useState<SaldoVenta | null>(null);
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [texto, setTexto] = useState('');

  const cliente = (id: string) => d.clientes.find(c => c.id === id)?.nombre ?? 'Cliente';
  const filas = d.saldos
    .map(s => ({ ...s, pendiente: saldoConPendientes(s.venta_id, Number(s.saldo), cola.pendientes) }))
    .filter(s => s.pendiente > 0)
    .filter(s => !texto || cliente(s.cliente_id).toLowerCase().includes(texto.toLowerCase()) || s.folio.toLowerCase().includes(texto.toLowerCase()));
  const saldoSel = venta ? saldoConPendientes(venta.venta_id, Number(venta.saldo), cola.pendientes) : 0;

  function abrir(s: SaldoVenta) {
    setVenta(s); setMonto(''); setMetodo('efectivo'); setReferencia(''); setError(''); setOk('');
  }

  function registrar(e: FormEvent) {
    e.preventDefault();
    if (!venta) return;
    const m = leerMonto(monto);
    if (Number.isNaN(m) || m <= 0) return setError('Captura un monto válido.');
    if (m > saldoSel) return setError(`El saldo pendiente es ${dinero(saldoSel)}.`);
    const id = nuevoId();
    try {
      encolar({
        id, tipo: 'pago', monto: m, ventaId: venta.venta_id,
        resumen: `Abono ${venta.folio} · ${cliente(venta.cliente_id)}`,
        datos: { id, venta_id: venta.venta_id, metodo, monto: m, referencia: referencia.trim() || null, registrado_en: new Date().toISOString() }
      });
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err));
    }
    setOk(`Abono de ${dinero(m)} a ${venta.folio} guardado. Saldo restante: ${dinero(saldoSel - m)}.`);
    setVenta(null);
  }

  return (
    <>
      {ok && <div className="mb-3"><Aviso tipo="exito">{ok}</Aviso></div>}
      <Tarjeta>
        <Entrada className="mb-3" placeholder="Buscar cliente o folio" value={texto} onChange={e => setTexto(e.target.value)} />
        {filas.length === 0 ? <Vacio>No tienes ventas a crédito con saldo pendiente.</Vacio> : (
          <ul className="divide-y divide-cacao-100">
            {filas.map(s => (
              <li key={s.venta_id}>
                <button onClick={() => abrir(s)} className="flex w-full items-center justify-between gap-3 py-3 text-left active:bg-cacao-50">
                  <span>
                    <span className="block font-semibold">{cliente(s.cliente_id)}</span>
                    <span className="text-xs text-cacao-600">{s.folio} · vence {s.fecha_vencimiento ?? '—'} {s.vencida && <Insignia tono="alerta">Vencida</Insignia>}</span>
                  </span>
                  <span className="num font-bold">{dinero(s.pendiente)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-cacao-600">Aparecen tus ventas a crédito. Los saldos se actualizan con señal.</p>
      </Tarjeta>

      <Panel titulo={venta ? `Abono a ${venta.folio}` : ''} abierto={!!venta} alCerrar={() => setVenta(null)}>
        {venta && (
          <form onSubmit={registrar} className="space-y-3">
            <p className="text-sm">{cliente(venta.cliente_id)} · saldo <b className="num">{dinero(saldoSel)}</b></p>
            <Campo etiqueta="Monto recibido">
              <Entrada autoFocus inputMode="decimal" value={monto} onChange={e => { setMonto(e.target.value); setError(''); }} />
            </Campo>
            <Boton type="button" variante="fantasma" onClick={() => setMonto(String(saldoSel))}>Liquidar {dinero(saldoSel)}</Boton>
            <div className="grid grid-cols-2 gap-2">
              {(['efectivo', 'transferencia'] as const).map(m => (
                <Boton key={m} type="button" variante={metodo === m ? 'primario' : 'secundario'} aria-pressed={metodo === m}
                       onClick={() => setMetodo(m)}>{NOMBRE_METODO[m]}</Boton>
              ))}
            </div>
            {metodo === 'transferencia' && (
              <Campo etiqueta="Referencia (opcional)"><Entrada value={referencia} onChange={e => setReferencia(e.target.value)} /></Campo>
            )}
            {error && <Aviso tipo="error">{error}</Aviso>}
            <Boton type="submit" grande className="w-full">Registrar abono</Boton>
          </form>
        )}
      </Panel>
    </>
  );
}

export function Cobrar() {
  return (
    <>
      <Encabezado titulo="Cobrar abono" detalle="Pagos de ventas a crédito" />
      <ConJornadaAbierta><ListaSaldos /></ConJornadaAbierta>
    </>
  );
}
