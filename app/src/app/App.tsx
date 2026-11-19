import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ProveedorSesion, useSesion } from '../auth/Sesion';
import { Ingreso } from '../auth/Ingreso';
import { supabaseConfigurado } from '../lib/supabase';
import type { Rol } from '../lib/tipos';
import { Aviso, Boton, Cargando } from '../ui/ui';
import { Marco } from './Marco';
import { Inicio } from '../modulos/inicio/Inicio';
import { Productos } from '../modulos/catalogo/Productos';
import { ImportarCatalogo } from '../modulos/catalogo/ImportarCatalogo';
import { Existencias } from '../modulos/inventario/Existencias';
import { NuevaEntrada } from '../modulos/inventario/NuevaEntrada';
import { Movimientos } from '../modulos/inventario/Movimientos';
import { Usuarios } from '../modulos/usuarios/Usuarios';
import { Configuracion } from '../modulos/configuracion/Configuracion';
import { MiRuta } from '../modulos/ruta/MiRuta';
import { Vender } from '../modulos/ruta/Vender';
import { Cobrar } from '../modulos/ruta/Cobrar';
import { Gasto } from '../modulos/ruta/Gasto';
import { Cierre } from '../modulos/ruta/Cierre';
import { Comprobante } from '../modulos/ruta/Comprobante';
import { Rutas } from '../modulos/rutas/Rutas';
import { DetalleJornada } from '../modulos/rutas/Jornada';
import { Ventas } from '../modulos/ventas/Ventas';
import { Clientes } from '../modulos/clientes/Clientes';

function Solo({ roles, children }: { roles: Rol[]; children: ReactNode }) {
  const { perfil } = useSesion();
  if (!perfil || !roles.includes(perfil.rol)) return <Aviso tipo="error">No tienes acceso a esta sección.</Aviso>;
  return <>{children}</>;
}

function Enrutador() {
  const { sesion, cargando, sinPerfil, errorPerfil, reintentar, salir } = useSesion();
  if (cargando) return <Cargando />;
  if (!sesion) return <Ingreso />;
  if (errorPerfil) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-6">
        <Aviso tipo="error">No se pudo cargar tu perfil: {errorPerfil}</Aviso>
        <div className="flex gap-2">
          <Boton onClick={reintentar}>Reintentar</Boton>
          <Boton variante="secundario" onClick={salir}>Cerrar sesión</Boton>
        </div>
      </main>
    );
  }
  if (sinPerfil) {
    return (
      <main className="mx-auto max-w-md space-y-4 p-6">
        <Aviso tipo="alerta">Tu cuenta existe, pero el administrador aún no te asigna un rol en GUVA, o está desactivada.</Aviso>
        <Boton variante="secundario" onClick={salir}>Cerrar sesión</Boton>
      </main>
    );
  }
  return (
    <Routes>
      <Route element={<Marco />}>
        <Route index element={<Inicio />} />
        <Route path="catalogo" element={<Productos />} />
        <Route path="catalogo/importar" element={<Solo roles={['admin']}><ImportarCatalogo /></Solo>} />
        <Route path="inventario" element={<Existencias />} />
        <Route path="inventario/entrada" element={<Solo roles={['admin', 'bodega']}><NuevaEntrada /></Solo>} />
        <Route path="inventario/movimientos" element={<Solo roles={['admin', 'bodega']}><Movimientos /></Solo>} />
        <Route path="ruta" element={<Solo roles={['vendedor']}><MiRuta /></Solo>} />
        <Route path="ruta/vender" element={<Solo roles={['vendedor']}><Vender /></Solo>} />
        <Route path="ruta/cobrar" element={<Solo roles={['vendedor']}><Cobrar /></Solo>} />
        <Route path="ruta/gasto" element={<Solo roles={['vendedor']}><Gasto /></Solo>} />
        <Route path="ruta/cierre" element={<Solo roles={['vendedor']}><Cierre /></Solo>} />
        <Route path="ruta/comprobante/:id" element={<Solo roles={['vendedor']}><Comprobante /></Solo>} />
        <Route path="rutas" element={<Solo roles={['admin', 'bodega']}><Rutas /></Solo>} />
        <Route path="rutas/:id" element={<Solo roles={['admin', 'bodega']}><DetalleJornada /></Solo>} />
        <Route path="ventas" element={<Solo roles={['admin', 'vendedor']}><Ventas /></Solo>} />
        <Route path="clientes" element={<Solo roles={['admin']}><Clientes /></Solo>} />
        <Route path="usuarios" element={<Solo roles={['admin']}><Usuarios /></Solo>} />
        <Route path="configuracion" element={<Solo roles={['admin']}><Configuracion /></Solo>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  if (!supabaseConfigurado) {
    return (
      <main className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-2xl font-bold">GUVA · Falta configurar</h1>
        <Aviso tipo="alerta">
          Crea el archivo <code>app/.env.local</code> con <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> de tu
          proyecto de Supabase (Project Settings → API) y reinicia <code>npm run dev</code>.
        </Aviso>
      </main>
    );
  }
  return (
    <ProveedorSesion>
      <BrowserRouter basename={import.meta.env.BASE_URL}><Enrutador /></BrowserRouter>
    </ProveedorSesion>
  );
}
