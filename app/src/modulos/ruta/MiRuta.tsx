import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { refrescarDatosRuta } from '../../lib/datosRuta';
import { descartar, reintentar, sincronizar } from '../../lib/cola';
import { useEnLinea } from '../../lib/useEnLinea';
import { dinero, fecha, piezas } from '../../lib/formato';
import { NOMBRE_JORNADA, type Carga, type CargaDetalle, type Gasto, type Pago, type Venta } from '../../lib/tipos';
import { Aviso, Boton, Encabezado, Insignia, Tarjeta } from '../../ui/ui';
import { enlaceBoton, useRuta } from './comun';

type CargaConDetalle = Carga & { carga_detalle: Pick<CargaDetalle, 'producto_id' | 'cantidad'>[] };

function CargasPorConfirmar({ jornadaId, nombres }: { jornadaId: string; nombres: Map<string, string> }) {
  const { perfil } = useRuta();
  const cargas = useConsulta(() => supabase.from('cargas').select('*, carga_detalle(producto_id,cantidad)')
    .eq('jornada_id', jornadaId).eq('estado', 'por_confirmar').order('creado_en'), [jornadaId]);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState('');
  const lista = (cargas.datos ?? []) as CargaConDetalle[];

  async function confirmar(id: string) {
    setError(''); setEnviando(id);
    const { error } = await supabase.rpc('confirmar_carga', { p_carga: id });
    setEnviando('');
    if (error) return setError(mensajeError(error));
    cargas.recargar();
    await refrescarDatosRuta(perfil.id);
  }

  if (cargas.error) return <Aviso tipo="alerta">No se pudieron consultar tus cargas: {cargas.error}</Aviso>;
  if (lista.length === 0) return null;
  return (
    <div className="space-y-3">
      {lista.map(c => (
        <Tarjeta key={c.id} className="ring-2 ring-ambar-400">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-bold">Carga {c.tipo} {c.folio}</h2>
            <Insignia tono="alerta">Por confirmar</Insignia>
          </div>
          <p className="mb-2 text-sm text-cacao-600">Cuenta la mercancía antes de confirmar. Al confirmar, queda a tu cargo.</p>
          <ul className="mb-3 divide-y divide-cacao-100 text-sm">
            {c.carga_detalle.map(d => (
              <li key={d.producto_id} className="flex justify-between py-1.5">
                <span>{nombres.get(d.producto_id) ?? 'Producto'}</span><b className="num">{piezas(d.cantidad)}</b>
              </li>
            ))}
          </ul>
          <p className="mb-3 text-right text-sm font-semibold">Total: {piezas(c.carga_detalle.reduce((s, d) => s + d.cantidad, 0))} piezas</p>
          {error && <div className="mb-2"><Aviso tipo="error">{error}</Aviso></div>}
          <Boton grande className="w-full" cargando={enviando === c.id} onClick={() => confirmar(c.id)}>Recibí la carga completa</Boton>
          <p className="mt-2 text-xs text-cacao-600">Si algo no coincide, no confirmes y avisa a bodega.</p>
        </Tarjeta>
      ))}
    </div>
  );
}

function ResumenJornada({ jornadaId }: { jornadaId: string }) {
  const { cola } = useRuta();
  const r = useConsulta(async () => {
    const [v, p, g] = await Promise.all([
      supabase.from('ventas').select('total,condicion').eq('jornada_id', jornadaId).eq('estado', 'cerrada'),
      supabase.from('pagos').select('monto,metodo').eq('jornada_id', jornadaId).eq('estado', 'cerrada'),
      supabase.from('gastos').select('monto,metodo').eq('jornada_id', jornadaId).eq('estado', 'cerrada')
    ]);
    const error = v.error ?? p.error ?? g.error;
    if (error) return { data: null, error };
    const ventas = (v.data ?? []) as Pick<Venta, 'total' | 'condicion'>[];
    const pagos = (p.data ?? []) as Pick<Pago, 'monto' | 'metodo'>[];
    const gastos = (g.data ?? []) as Pick<Gasto, 'monto' | 'metodo'>[];
    const suma = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
    return {
      data: {
        ventas: suma(ventas, x => Number(x.total)), num: ventas.length,
        credito: suma(ventas.filter(x => x.condicion === 'credito'), x => Number(x.total)),
        efectivo: suma(pagos.filter(x => x.metodo === 'efectivo'), x => Number(x.monto)),
        transferencia: suma(pagos.filter(x => x.metodo !== 'efectivo'), x => Number(x.monto)),
        gastosEfectivo: suma(gastos.filter(x => x.metodo === 'efectivo'), x => Number(x.monto))
      },
      error: null
    };
    // Se recalcula cada vez que se envía algo de la cola
  }, [jornadaId, cola.enviados[0]?.id]);
  const d = r.datos;
  const pendientes = cola.pendientes.filter(p => p.tipo === 'venta');
  return (
    <Tarjeta>
      <h2 className="mb-2 font-bold">Tu jornada</h2>
      {r.error && !d ? <p className="text-sm text-cacao-600">Sin conexión: el resumen del servidor se mostrará al volver la señal.</p> : d && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-cacao-600">Ventas ({d.num})</dt><dd className="num text-right font-semibold">{dinero(d.ventas)}</dd>
          <dt className="text-cacao-600">A crédito</dt><dd className="num text-right">{dinero(d.credito)}</dd>
          <dt className="text-cacao-600">Cobrado en efectivo</dt><dd className="num text-right">{dinero(d.efectivo)}</dd>
          <dt className="text-cacao-600">Transferencias</dt><dd className="num text-right">{dinero(d.transferencia)}</dd>
          <dt className="text-cacao-600">Gastos en efectivo</dt><dd className="num text-right">−{dinero(d.gastosEfectivo)}</dd>
          <dt className="font-semibold">Efectivo que debes traer</dt><dd className="num text-right font-bold">{dinero(d.efectivo - d.gastosEfectivo)}</dd>
        </dl>
      )}
      {pendientes.length > 0 && (
        <p className="mt-2 text-xs text-amber-800">Más {pendientes.length} venta(s) por enviar (≈ {dinero(pendientes.reduce((s, p) => s + p.monto, 0))}).</p>
      )}
    </Tarjeta>
  );
}

export function PanelCola() {
  const { cola } = useRuta();
  const enLinea = useEnLinea();
  if (cola.pendientes.length === 0 && cola.enviados.length === 0) return null;
  const conError = cola.pendientes.filter(p => p.error);
  return (
    <Tarjeta>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-bold">Envíos al servidor</h2>
        {cola.pendientes.length > 0 && (
          <Boton variante="secundario" cargando={cola.enviando} disabled={!enLinea} onClick={() => void sincronizar()}>Enviar ahora</Boton>
        )}
      </div>
      {cola.pendientes.length === 0
        ? <p className="text-sm text-green-800">Todo enviado.</p>
        : <p className="text-sm text-cacao-600">{cola.pendientes.length} por enviar{!enLinea && ' · se enviarán al volver la señal'}.</p>}
      {conError.length > 0 && (
        <div className="mt-3 space-y-2">
          <Aviso tipo="error">El servidor rechazó {conError.length} registro(s). Revisa cada uno: corrígelo con el administrador y reintenta, o descártalo.</Aviso>
          {conError.map(p => (
            <div key={p.id} className="rounded-xl bg-red-50 p-3 text-sm">
              <p className="font-semibold">{p.resumen} · {dinero(p.monto)}</p>
              <p className="text-red-800">{p.error}</p>
              <div className="mt-2 flex gap-2">
                <Boton variante="secundario" onClick={() => reintentar(p.id)}>Reintentar</Boton>
                <Boton variante="peligro" onClick={() => {
                  if (confirm(`¿Descartar "${p.resumen}"? No quedará registrado en GUVA.`)) descartar(p.id);
                }}>Descartar</Boton>
              </div>
            </div>
          ))}
        </div>
      )}
      <ul className="mt-3 divide-y divide-cacao-100 text-sm">
        {cola.pendientes.filter(p => !p.error).map(p => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span>{p.resumen}</span>
            <span className="flex items-center gap-2"><span className="num">{dinero(p.monto)}</span><Insignia tono="alerta">Pendiente</Insignia></span>
          </li>
        ))}
        {cola.enviados.slice(0, 8).map(e => (
          <li key={e.id} className="flex items-center justify-between gap-2 py-2">
            {e.tipo === 'venta'
              ? <Link to={`/ruta/comprobante/${e.id}`} className="underline">{e.folio} · {e.resumen}</Link>
              : <span>{e.folio} · {e.resumen}</span>}
            <span className="flex items-center gap-2">{e.total != null && <span className="num">{dinero(e.total)}</span>}<Insignia tono="ok">Enviado</Insignia></span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

export function MiRuta() {
  const { perfil, datos, cargando, error } = useRuta();
  const enLinea = useEnLinea();
  const j = datos?.jornada ?? null;
  const nombres = new Map((datos?.productos ?? []).map(p => [p.id, p.nombre]));

  return (
    <>
      <Encabezado titulo="Mi ruta"
        detalle={datos ? `Datos al ${fecha(datos.actualizado)}` : undefined}
        acciones={<Boton variante="secundario" cargando={cargando} disabled={!enLinea} onClick={() => void refrescarDatosRuta(perfil.id)}>Actualizar</Boton>} />
      {error && <div className="mb-3"><Aviso tipo="alerta">No se pudieron actualizar los datos ({error}). Se usa la última copia del teléfono.</Aviso></div>}

      <div className="space-y-4">
        {!datos ? (
          <Aviso tipo="alerta">{cargando ? 'Descargando tus datos de ruta…' : 'Conéctate a internet para descargar tus datos de ruta.'}</Aviso>
        ) : !j ? (
          <Tarjeta>
            <p className="font-semibold">No tienes una jornada activa.</p>
            <p className="mt-1 text-sm text-cacao-600">El administrador abre tu jornada y bodega prepara tu carga. Cuando esté lista aparecerá aquí para que la confirmes.</p>
          </Tarjeta>
        ) : (
          <>
            <Tarjeta>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-cacao-600">Jornada del {j.fecha}</p>
                  <p className="text-lg font-bold">{NOMBRE_JORNADA[j.estado]}</p>
                </div>
                <Insignia tono={j.estado === 'abierta' ? 'ok' : 'neutro'}>{NOMBRE_JORNADA[j.estado]}</Insignia>
              </div>
            </Tarjeta>

            {(j.estado === 'preparacion' || j.estado === 'abierta') && (
              enLinea ? <CargasPorConfirmar jornadaId={j.id} nombres={nombres} />
                : <p className="text-sm text-cacao-600">Las cargas por confirmar se revisan con señal.</p>
            )}

            {j.estado === 'preparacion' && (
              <Aviso>Bodega está preparando tu carga. Cuando la despachen, confírmala aquí para abrir tu jornada.</Aviso>
            )}

            {j.estado === 'abierta' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Link to="/ruta/vender" className={`${enlaceBoton} col-span-2 min-h-16 bg-cacao-800 text-lg text-white`}>Vender</Link>
                  <Link to="/ruta/cobrar" className={`${enlaceBoton} min-h-14 bg-white ring-1 ring-cacao-200`}>Cobrar abono</Link>
                  <Link to="/ruta/gasto" className={`${enlaceBoton} min-h-14 bg-white ring-1 ring-cacao-200`}>Registrar gasto</Link>
                  <Link to="/ruta/cierre" className={`${enlaceBoton} col-span-2 min-h-12 bg-ambar-500 text-cacao-900`}>Cerrar ruta</Link>
                </div>
                <ResumenJornada jornadaId={j.id} />
              </>
            )}

            {j.estado === 'en_cierre' && (
              <Aviso tipo="info">Tu cierre está en revisión del administrador. Cuando lo apruebe, tu jornada quedará cerrada.</Aviso>
            )}
          </>
        )}
        <PanelCola />
      </div>
    </>
  );
}
