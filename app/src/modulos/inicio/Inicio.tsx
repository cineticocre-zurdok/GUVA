import { Link } from 'react-router-dom';
import { useSesion } from '../../auth/Sesion';
import { supabase } from '../../lib/supabase';
import { useConsulta } from '../../lib/useConsulta';
import { dinero, hoyMexico, piezas } from '../../lib/formato';
import type { Configuracion, ExistenciaVista, ResumenDiario } from '../../lib/tipos';
import { Aviso, Encabezado, Tarjeta } from '../../ui/ui';

function Indicador({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <Tarjeta>
      <p className="text-xs font-semibold uppercase tracking-wide text-cacao-600">{titulo}</p>
      <p className="num mt-1 text-2xl font-bold">{valor}</p>
      {nota && <p className="mt-1 text-xs text-cacao-600">{nota}</p>}
    </Tarjeta>
  );
}

function BajoMinimo() {
  const { datos } = useConsulta(() => supabase.from('v_existencias').select('*').eq('bajo_minimo', true).order('producto'), []);
  const lista = (datos ?? []) as ExistenciaVista[];
  return (
    <Tarjeta>
      <h2 className="mb-2 font-bold">Bajo stock mínimo en bodega</h2>
      {lista.length === 0 ? <p className="text-sm text-cacao-600">Ningún producto por debajo de su mínimo.</p> : (
        <ul className="divide-y divide-cacao-100 text-sm">
          {lista.slice(0, 8).map(e => (
            <li key={e.producto_id} className="flex justify-between py-2">
              <span>{e.producto}</span>
              <span className="num font-semibold text-red-700">{piezas(e.cantidad)} / mín. {piezas(e.stock_minimo)}</span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

function InicioAdmin() {
  const hoy = hoyMexico();
  const { datos: resumen } = useConsulta(() => supabase.from('v_resumen_diario').select('*').eq('dia', hoy).maybeSingle(), [hoy]);
  const { datos: config } = useConsulta(() => supabase.from('configuracion').select('*').single(), []);
  const r = resumen as ResumenDiario | null;
  const c = config as Configuracion | null;
  const porConfigurar = c && [c.razon_social, c.rfc, c.direccion, c.telefono].some(v => v === 'POR CONFIGURAR');

  return (
    <>
      <Encabezado titulo="Resumen de hoy" detalle={hoy} />
      {porConfigurar && (
        <div className="mb-4">
          <Aviso tipo="alerta">Faltan datos de GUVA para los comprobantes (razón social, RFC, dirección o teléfono). <Link className="font-semibold underline" to="/configuracion">Completar</Link></Aviso>
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador titulo="Venta neta" valor={dinero(r?.venta_neta ?? 0)} nota={`Crédito: ${dinero(r?.venta_credito ?? 0)}`} />
        <Indicador titulo="Cobrado" valor={dinero(r?.cobrado ?? 0)} />
        <Indicador titulo="Margen bruto" valor={dinero(r?.margen_bruto ?? 0)} nota="Venta neta − costo vendido" />
        <Indicador titulo="Gastos" valor={dinero(r?.gastos ?? 0)} nota={`Resultado est.: ${dinero(r?.resultado_operativo_estimado ?? 0)}`} />
      </div>
      <BajoMinimo />
      <p className="mt-4 text-xs text-cacao-600">
        Jornadas, cargas y cierres en <Link to="/rutas" className="underline">Rutas</Link>. Mayoreo, cuentas por cobrar y dashboard completo llegan en las siguientes entregas.
      </p>
    </>
  );
}

function InicioVendedor() {
  const { perfil } = useSesion();
  const { datos } = useConsulta(() => supabase.from('v_existencias').select('*').eq('tipo_ubicacion', 'vendedor').gt('cantidad', 0), []);
  const lista = (datos ?? []) as ExistenciaVista[];
  const total = lista.reduce((s, e) => s + e.cantidad, 0);
  return (
    <>
      <Encabezado titulo={`Hola, ${perfil?.nombre}`} />
      <div className="grid gap-3 md:grid-cols-2">
        <Indicador titulo="Piezas en tu inventario de ruta" valor={piezas(total)} nota={`${lista.length} productos`} />
        <Tarjeta>
          <p className="font-semibold">Ventas en ruta</p>
          <p className="mt-1 text-sm text-cacao-600">Confirma tu carga, vende, cobra, registra gastos y cierra tu ruta. Funciona sin señal.</p>
          <Link to="/ruta" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-cacao-800 px-4 text-sm font-semibold text-white">Ir a Mi ruta</Link>
        </Tarjeta>
      </div>
    </>
  );
}

export function Inicio() {
  const { perfil } = useSesion();
  if (perfil?.rol === 'admin') return <InicioAdmin />;
  if (perfil?.rol === 'vendedor') return <InicioVendedor />;
  return (
    <>
      <Encabezado titulo={`Hola, ${perfil?.nombre}`} acciones={<>
        <Link to="/rutas" className="rounded-xl bg-white px-4 py-2.5 font-semibold ring-1 ring-cacao-200">Preparar cargas</Link>
        <Link to="/inventario/entrada" className="rounded-xl bg-cacao-800 px-4 py-2.5 font-semibold text-white">Registrar entrada</Link>
      </>} />
      <BajoMinimo />
    </>
  );
}
