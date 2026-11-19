import { useState, type FormEvent } from 'react';
import { useSesion } from '../../auth/Sesion';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { NOMBRE_ROL, type Perfil, type Rol } from '../../lib/tipos';
import { Aviso, Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Panel, Selector, Tabla, Tarjeta } from '../../ui/ui';

const ROLES: Rol[] = ['admin', 'vendedor', 'bodega'];

interface Edicion { id: string; email?: string; nombre: string; rol: Rol; activo: boolean; nuevo: boolean }

export function Usuarios() {
  const { perfil: yo } = useSesion();
  const perfiles = useConsulta(() => supabase.from('perfiles').select('id,nombre,rol,activo').order('nombre'), []);
  const pendientes = useConsulta(() => supabase.rpc('usuarios_sin_perfil'), []);
  const [ed, setEd] = useState<Edicion | null>(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!ed) return;
    setError(''); setGuardando(true);
    const { error } = await supabase.rpc('alta_perfil', { p_usuario: ed.id, p_nombre: ed.nombre, p_rol: ed.rol, p_activo: ed.activo });
    setGuardando(false);
    if (error) return setError(mensajeError(error));
    setEd(null); perfiles.recargar(); pendientes.recargar();
  }

  const sinPerfil = (pendientes.datos ?? []) as { id: string; email: string }[];

  return (
    <>
      <Encabezado titulo="Usuarios" detalle="Cada persona entra con su propio usuario: así cada venta queda a su nombre" />

      <Tarjeta className="mb-4">
        <h2 className="mb-2 font-bold">Cuentas sin rol asignado</h2>
        <p className="mb-3 text-sm text-cacao-600">
          Las cuentas (correo y contraseña) se crean en Supabase → Authentication → Users → Add user. Después aparecen aquí para asignarles nombre y rol.
          Un vendedor recibe automáticamente su inventario de ruta.
        </p>
        {sinPerfil.length === 0 ? <p className="text-sm">No hay cuentas pendientes.</p> : (
          <ul className="divide-y divide-cacao-100">
            {sinPerfil.map(u => (
              <li key={u.id} className="flex items-center justify-between py-2">
                <span>{u.email}</span>
                <Boton variante="secundario" onClick={() => setEd({ id: u.id, email: u.email, nombre: '', rol: 'vendedor', activo: true, nuevo: true })}>Asignar rol</Boton>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta>
        {perfiles.error && <Aviso tipo="error">{perfiles.error}</Aviso>}
        {perfiles.cargando ? <Cargando /> : (
          <Tabla filas={(perfiles.datos ?? []) as Perfil[]} llave={p => p.id}
            alTocar={p => setEd({ ...p, nuevo: false })}
            columnas={[
              { titulo: 'Nombre', celda: p => <>{p.nombre} {p.id === yo?.id && <Insignia>Tú</Insignia>}</> },
              { titulo: 'Rol', celda: p => NOMBRE_ROL[p.rol] },
              { titulo: 'Estado', celda: p => p.activo ? <Insignia tono="ok">Activo</Insignia> : <Insignia tono="alerta">Inactivo</Insignia> }
            ]} />
        )}
      </Tarjeta>

      <Panel titulo={ed?.nuevo ? `Asignar rol · ${ed.email}` : 'Editar usuario'} abierto={!!ed} alCerrar={() => { setEd(null); setError(''); }}>
        {ed && (
          <form onSubmit={guardar} className="space-y-3">
            <Campo etiqueta="Nombre"><Entrada required value={ed.nombre} onChange={e => setEd({ ...ed, nombre: e.target.value })} /></Campo>
            <Campo etiqueta="Rol" ayuda={ed.rol === 'vendedor' ? 'Ve solo sus ventas y su inventario; no ve costos.' : ed.rol === 'bodega' ? 'Entradas, cargas e inventario; no ve costos ni finanzas.' : 'Acceso completo.'}>
              <Selector value={ed.rol} onChange={e => setEd({ ...ed, rol: e.target.value as Rol })}>
                {ROLES.map(r => <option key={r} value={r}>{NOMBRE_ROL[r]}</option>)}
              </Selector>
            </Campo>
            {!ed.nuevo && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ed.activo} onChange={e => setEd({ ...ed, activo: e.target.checked })} /> Usuario activo
              </label>
            )}
            {error && <Aviso tipo="error">{error}</Aviso>}
            <Boton type="submit" grande className="w-full" cargando={guardando}>Guardar</Boton>
          </form>
        )}
      </Panel>
    </>
  );
}
