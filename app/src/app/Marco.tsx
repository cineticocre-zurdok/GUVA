import { NavLink, Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useSesion } from '../auth/Sesion';
import { NOMBRE_ROL, type Rol } from '../lib/tipos';
import { useEnLinea } from '../lib/useEnLinea';
import { alTerminarEnvio, estadoCola, iniciarCola, sincronizar, useCola } from '../lib/cola';
import { iniciarDatosRuta, refrescarDatosRuta } from '../lib/datosRuta';

interface ItemMenu { a: string; texto: string; icono: string; roles: Rol[] }

export const MENU: ItemMenu[] = [
  { a: '/', texto: 'Inicio', icono: '⌂', roles: ['admin', 'vendedor', 'bodega'] },
  { a: '/ruta', texto: 'Mi ruta', icono: '⛟', roles: ['vendedor'] },
  { a: '/rutas', texto: 'Rutas', icono: '⛟', roles: ['admin', 'bodega'] },
  { a: '/ventas', texto: 'Ventas', icono: '$', roles: ['admin', 'vendedor'] },
  { a: '/clientes', texto: 'Clientes', icono: '☷', roles: ['admin'] },
  { a: '/catalogo', texto: 'Catálogo', icono: '▦', roles: ['admin', 'vendedor', 'bodega'] },
  { a: '/inventario', texto: 'Inventario', icono: '▤', roles: ['admin', 'vendedor', 'bodega'] },
  { a: '/inventario/entrada', texto: 'Entrada', icono: '＋', roles: ['admin', 'bodega'] },
  { a: '/usuarios', texto: 'Usuarios', icono: '☺', roles: ['admin'] },
  { a: '/configuracion', texto: 'Ajustes', icono: '⚙', roles: ['admin'] }
];

const INTERVALO_ENVIO_MS = 30_000;

/** Envía la cola y refresca la copia local del vendedor cuando conviene. */
function useSincronizacion(uid: string, esVendedor: boolean) {
  useEffect(() => {
    const refrescar = () => { if (esVendedor && navigator.onLine) void refrescarDatosRuta(uid); };
    const enviar = () => { if (navigator.onLine) void sincronizar(); };
    const alVolver = () => { enviar(); refrescar(); };
    const alMostrar = () => { if (document.visibilityState === 'visible') alVolver(); };

    alVolver();
    const quitar = alTerminarEnvio(refrescar);
    const reloj = window.setInterval(enviar, INTERVALO_ENVIO_MS);
    window.addEventListener('online', alVolver);
    document.addEventListener('visibilitychange', alMostrar);
    return () => {
      quitar(); window.clearInterval(reloj);
      window.removeEventListener('online', alVolver);
      document.removeEventListener('visibilitychange', alMostrar);
    };
  }, [uid, esVendedor]);
}

export function Marco() {
  const { perfil, salir } = useSesion();
  // Carga la cola y la copia local de este usuario antes de pintar las pantallas
  iniciarCola(perfil?.id ?? null);
  iniciarDatosRuta(perfil?.rol === 'vendedor' ? perfil.id : null);
  useSincronizacion(perfil?.id ?? '', perfil?.rol === 'vendedor');
  const enLinea = useEnLinea();
  const cola = useCola();
  const { needRefresh: [hayVersion], updateServiceWorker } = useRegisterSW();
  const items = MENU.filter(i => perfil && i.roles.includes(perfil.rol));
  const porEnviar = cola.pendientes.length;

  async function cerrarSesion() {
    const n = estadoCola().pendientes.length;
    if (n > 0 && !confirm(`Hay ${n} registro(s) sin enviar. Se quedan guardados en este teléfono y se enviarán cuando vuelvas a entrar con tu usuario. ¿Cerrar sesión?`)) return;
    await salir();
  }

  const enlace = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium ${isActive ? 'bg-ambar-500 text-cacao-900' : 'text-cacao-100 hover:bg-cacao-600'}`;
  const exacto = (a: string) => a === '/' || a === '/inventario';

  return (
    <div className="flex min-h-full">
      {/* Menú lateral: escritorio (PC matriz) */}
      <aside className="no-imprimir sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-cacao-800 p-4 md:flex">
        <div className="mb-6 flex items-center gap-2">
          <img src="/icono.svg" alt="" className="h-9 w-9" />
          <span className="text-xl font-bold text-white">GUVA</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {items.map(i => (
            <NavLink key={i.a} to={i.a} end={exacto(i.a)} className={enlace}>
              <span aria-hidden className="w-5 text-center">{i.icono}</span>{i.texto}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-cacao-600 pt-3 text-sm text-cacao-100">
          <p className="font-semibold text-white">{perfil?.nombre}</p>
          <p className="text-cacao-200">{perfil && NOMBRE_ROL[perfil.rol]}</p>
          <button onClick={cerrarSesion} className="mt-2 text-ambar-400 hover:underline">Cerrar sesión</button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior: celular */}
        <header className="no-imprimir sticky top-0 z-30 flex items-center justify-between bg-cacao-800 px-4 py-3 text-white md:hidden">
          <div className="flex items-center gap-2">
            <img src="/icono.svg" alt="" className="h-7 w-7" />
            <span className="font-bold">GUVA</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {porEnviar > 0 && <span className="rounded-full bg-ambar-500 px-2 py-0.5 text-xs font-bold text-cacao-900" title="Registros por enviar">{porEnviar} por enviar</span>}
            <span className="text-cacao-200">{perfil?.nombre}</span>
            <button onClick={cerrarSesion} className="text-ambar-400">Salir</button>
          </div>
        </header>

        {!enLinea && (
          <div className="no-imprimir bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900">
            Sin conexión. {perfil?.rol === 'vendedor'
              ? 'Puedes seguir vendiendo: ventas, cobros y gastos se guardan en el teléfono y se envían solos al volver la señal.'
              : 'Lo que ves puede no estar actualizado y los registros requieren internet.'}
          </div>
        )}
        {enLinea && porEnviar > 0 && (
          <div className="no-imprimir hidden bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 md:block">
            {porEnviar} registro(s) por enviar al servidor{cola.enviando ? '… enviando' : ''}.
          </div>
        )}
        {hayVersion && (
          <div className="no-imprimir flex items-center justify-center gap-3 bg-cacao-100 px-4 py-2 text-sm">
            Hay una versión nueva de GUVA.
            <button className="font-semibold text-cacao-800 underline" onClick={() => updateServiceWorker(true)}>Actualizar</button>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-28 md:p-8">
          <Outlet />
        </main>

        {/* Navegación inferior: celular */}
        <nav className="no-imprimir fixed inset-x-0 bottom-0 z-30 grid border-t border-cacao-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
             style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map(i => (
            <NavLink key={i.a} to={i.a} end={exacto(i.a)}
              className={({ isActive }) => `flex min-w-0 flex-col items-center py-2 text-[11px] leading-tight ${isActive ? 'font-bold text-cacao-800' : 'text-cacao-600'}`}>
              <span aria-hidden className="text-xl leading-6">{i.icono}</span>{i.texto}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
