import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTieneRol } from '../../auth/Sesion';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { fecha, hoyMexico } from '../../lib/formato';
import { NOMBRE_JORNADA, type Jornada, type Ubicacion } from '../../lib/tipos';
import { Aviso, Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Panel, Selector, Tabla, Tarjeta, Vacio } from '../../ui/ui';

export type JornadaConRuta = Jornada & { ubicaciones: { nombre: string } | null };

const ACTIVAS = ['preparacion', 'abierta', 'en_cierre'];

export function Rutas() {
  const esAdmin = useTieneRol('admin');
  const navegar = useNavigate();
  const jornadas = useConsulta(() => supabase.from('jornadas_ruta').select('*, ubicaciones(nombre)')
    .order('creado_en', { ascending: false }).limit(80), []);
  const rutas = useConsulta(() => supabase.from('ubicaciones').select('*').eq('tipo', 'vendedor').eq('activo', true).order('nombre'), []);
  const [abrir, setAbrir] = useState(false);
  const [vendedor, setVendedor] = useState('');
  const [dia, setDia] = useState(hoyMexico());
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const lista = (jornadas.datos ?? []) as JornadaConRuta[];
  const activas = lista.filter(j => ACTIVAS.includes(j.estado));
  const historial = lista.filter(j => !ACTIVAS.includes(j.estado));
  const libres = ((rutas.datos ?? []) as Ubicacion[]).filter(u => !activas.some(j => j.vendedor_id === u.vendedor_id));

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!vendedor) return setError('Elige la ruta.');
    setError(''); setEnviando(true);
    const { data, error } = await supabase.rpc('crear_jornada', { p_vendedor: vendedor, p_fecha: dia });
    setEnviando(false);
    if (error) return setError(mensajeError(error));
    navegar(`/rutas/${data as string}`);
  }

  const columnas = [
    { titulo: 'Ruta', celda: (j: JornadaConRuta) => j.ubicaciones?.nombre ?? '—' },
    { titulo: 'Fecha', celda: (j: JornadaConRuta) => j.fecha },
    { titulo: 'Estado', celda: (j: JornadaConRuta) => <Insignia tono={j.estado === 'en_cierre' ? 'alerta' : j.estado === 'abierta' ? 'ok' : 'neutro'}>{NOMBRE_JORNADA[j.estado]}</Insignia> },
    { titulo: 'Abierta', celda: (j: JornadaConRuta) => fecha(j.abierta_en), ocultarMovil: true }
  ];

  return (
    <>
      <Encabezado titulo="Rutas" detalle="Jornadas de los vendedores, cargas y cierres"
        acciones={esAdmin && <Boton onClick={() => { setAbrir(true); setVendedor(libres[0]?.vendedor_id ?? ''); setError(''); }}>Abrir jornada</Boton>} />
      {jornadas.error && <div className="mb-3"><Aviso tipo="error">{jornadas.error}</Aviso></div>}

      <Tarjeta className="mb-4">
        <h2 className="mb-2 font-bold">Activas</h2>
        {jornadas.cargando ? <Cargando /> : activas.length === 0 ? <Vacio>No hay jornadas activas.</Vacio>
          : <Tabla filas={activas} llave={j => j.id} columnas={columnas} alTocar={j => navegar(`/rutas/${j.id}`)} />}
      </Tarjeta>

      <Tarjeta>
        <h2 className="mb-2 font-bold">Historial reciente</h2>
        {historial.length === 0 ? <Vacio>Sin jornadas cerradas.</Vacio>
          : <Tabla filas={historial} llave={j => j.id} columnas={columnas} alTocar={j => navegar(`/rutas/${j.id}`)} />}
      </Tarjeta>

      <Panel titulo="Abrir jornada" abierto={abrir} alCerrar={() => setAbrir(false)}>
        <form onSubmit={crear} className="space-y-3">
          {libres.length === 0 ? <Aviso tipo="alerta">Todas las rutas tienen una jornada activa, o no hay vendedores. Asigna el rol de vendedor en Usuarios.</Aviso> : (
            <Campo etiqueta="Ruta (vendedor)">
              <Selector value={vendedor} onChange={e => setVendedor(e.target.value)}>
                {libres.map(u => <option key={u.id} value={u.vendedor_id!}>{u.nombre}</option>)}
              </Selector>
            </Campo>
          )}
          <Campo etiqueta="Fecha"><Entrada type="date" value={dia} onChange={e => setDia(e.target.value)} /></Campo>
          <p className="text-xs text-cacao-600">Se toma una fotografía de lo que el vendedor ya trae. Después, bodega prepara la carga y el vendedor la confirma en su teléfono.</p>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <Boton type="submit" className="w-full" cargando={enviando} disabled={libres.length === 0}>Abrir jornada</Boton>
        </form>
      </Panel>
    </>
  );
}
