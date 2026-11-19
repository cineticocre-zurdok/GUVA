import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { traerTodo } from '../../lib/traerTodo';
import { refrescarDatosRuta } from '../../lib/datosRuta';
import { useEnLinea } from '../../lib/useEnLinea';
import { dinero, piezas } from '../../lib/formato';
import { leerMonto } from '../../lib/ruta';
import type { ExistenciaVista, Producto } from '../../lib/tipos';
import { Aviso, Boton, Campo, Cargando, Encabezado, Entrada, Tarjeta } from '../../ui/ui';
import { BuscadorProducto } from '../../ui/BuscadorProducto';
import { ConJornadaAbierta, useRuta } from './comun';

interface Resultado { folio: string; efectivo_esperado: number; diferencia_efectivo: number; piezas_diferencia: number }

function VerResultado({ resultado }: { resultado: Resultado }) {
  const cuadra = resultado.diferencia_efectivo === 0 && resultado.piezas_diferencia === 0;
  return (
    <Tarjeta className="max-w-lg space-y-3">
      <Aviso tipo={cuadra ? 'exito' : 'alerta'}>Cierre <b>{resultado.folio}</b> enviado al administrador para revisión.</Aviso>
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt>Efectivo esperado</dt><dd className="num text-right">{dinero(resultado.efectivo_esperado)}</dd>
        <dt>Diferencia de efectivo</dt>
        <dd className={`num text-right font-bold ${resultado.diferencia_efectivo < 0 ? 'text-red-700' : ''}`}>{dinero(resultado.diferencia_efectivo)}</dd>
        <dt>Piezas con diferencia</dt><dd className="num text-right font-bold">{piezas(resultado.piezas_diferencia)}</dd>
      </dl>
      <Link to="/ruta" className="inline-block font-semibold underline">Volver a Mi ruta</Link>
    </Tarjeta>
  );
}

function Conteo({ alCerrar }: { alCerrar: (r: Resultado) => void }) {
  const { perfil, datos, cola } = useRuta();
  const d = datos!;
  const enLinea = useEnLinea();
  const exist = useConsulta(() => traerTodo<ExistenciaVista>(() => supabase.from('v_existencias').select('*')
    .eq('ubicacion_id', d.ubicacionId ?? '').gt('cantidad', 0).order('producto').order('producto_id')), [d.ubicacionId]);
  const [extra, setExtra] = useState<{ id: string; nombre: string }[]>([]);
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [efectivo, setEfectivo] = useState('');
  const [obs, setObs] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (!enLinea) return <Aviso tipo="alerta">El cierre de ruta requiere señal. Conéctate a internet para cerrar.</Aviso>;
  if (cola.pendientes.length > 0) {
    return (
      <Aviso tipo="alerta">
        Tienes {cola.pendientes.length} registro(s) sin enviar. Envíalos (o descarta los rechazados) en <Link to="/ruta" className="font-semibold underline">Mi ruta</Link> antes de cerrar.
      </Aviso>
    );
  }
  if (exist.cargando) return <Cargando />;
  if (exist.error) return <Aviso tipo="error">{exist.error}</Aviso>;

  const base = ((exist.datos ?? []) as ExistenciaVista[]).map(e => ({ id: e.producto_id, nombre: e.producto }));
  const productos = [...base, ...extra.filter(x => !base.some(b => b.id === x.id))];

  function agregarExtra(p: Producto) {
    if (!productos.some(x => x.id === p.id)) setExtra(xs => [...xs, { id: p.id, nombre: p.nombre }]);
  }

  async function cerrar(e: FormEvent) {
    e.preventDefault();
    setError('');
    const faltan = productos.filter(p => !/^\d+$/.test(conteo[p.id] ?? ''));
    if (faltan.length) return setError(`Falta contar: ${faltan.map(f => f.nombre).join(', ')}. Si no queda ninguno, escribe 0.`);
    const ef = leerMonto(efectivo);
    if (Number.isNaN(ef)) return setError('Captura el efectivo que entregas (puede ser 0).');
    if (!confirm('¿Cerrar la ruta? Después ya no podrás vender en esta jornada.')) return;
    setEnviando(true);
    const { data, error } = await supabase.rpc('cerrar_ruta', {
      p_jornada: d.jornada!.id,
      p_conteo: productos.map(p => ({ producto_id: p.id, cantidad: parseInt(conteo[p.id], 10) })),
      p_efectivo_entregado: ef,
      p_observaciones: obs.trim() || null
    });
    setEnviando(false);
    if (error) return setError(mensajeError(error));
    alCerrar(data as Resultado);
    void refrescarDatosRuta(perfil.id);
  }

  return (
    <form onSubmit={cerrar} className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Tarjeta>
        <h2 className="mb-1 font-bold">Conteo físico</h2>
        <p className="mb-3 text-sm text-cacao-600">Cuenta lo que te queda en el vehículo y escribe cuántas piezas hay de cada producto.</p>
        <ul className="divide-y divide-cacao-100">
          {productos.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span>{p.nombre}</span>
              <Entrada className="w-24 text-center" inputMode="numeric" aria-label={`Piezas contadas de ${p.nombre}`}
                       value={conteo[p.id] ?? ''} onChange={e => setConteo(c => ({ ...c, [p.id]: e.target.value.replace(/\D/g, '') }))} />
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <p className="mb-1 text-sm text-cacao-600">¿Encontraste un producto que no está en la lista?</p>
          <BuscadorProducto productos={d.productos} alElegir={agregarExtra} placeholder="Agregar producto al conteo" />
        </div>
      </Tarjeta>

      <Tarjeta className="space-y-3 self-start">
        <Campo etiqueta="Efectivo que entregas"><Entrada inputMode="decimal" value={efectivo} onChange={e => setEfectivo(e.target.value)} /></Campo>
        <Campo etiqueta="Observaciones (opcional)"><Entrada value={obs} onChange={e => setObs(e.target.value)} /></Campo>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Boton type="submit" grande className="w-full" cargando={enviando}>Cerrar ruta</Boton>
        <p className="text-xs text-cacao-600">El sistema compara tu conteo y tu efectivo con lo registrado. El administrador revisa las diferencias.</p>
      </Tarjeta>
    </form>
  );
}

export function Cierre() {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  return (
    <>
      <Encabezado titulo="Cierre de ruta" />
      {resultado ? <VerResultado resultado={resultado} />
        : <ConJornadaAbierta><Conteo alCerrar={setResultado} /></ConJornadaAbierta>}
    </>
  );
}
