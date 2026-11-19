import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSesion } from '../../auth/Sesion';
import { useCola } from '../../lib/cola';
import { useDatosRuta } from '../../lib/datosRuta';
import { Aviso, Cargando } from '../../ui/ui';

/** Sesión + copia local + cola del vendedor actual. */
export function useRuta() {
  const { perfil } = useSesion();
  const { datos, cargando, error } = useDatosRuta();
  const cola = useCola();
  const propios = datos && perfil && datos.uid === perfil.id ? datos : null;
  return { perfil: perfil!, datos: propios, cargando, error, cola };
}

/** Muestra el contenido solo si hay una jornada abierta en la copia local. */
export function ConJornadaAbierta({ children }: { children: ReactNode }) {
  const { datos, cargando } = useRuta();
  if (!datos) return cargando ? <Cargando /> : <Aviso tipo="alerta">Aún no se descargan tus datos de ruta. Conéctate a internet una vez y vuelve a intentar.</Aviso>;
  if (datos.jornada?.estado !== 'abierta') {
    return (
      <Aviso tipo="alerta">
        No tienes una jornada abierta. <Link to="/ruta" className="font-semibold underline">Ir a Mi ruta</Link>
      </Aviso>
    );
  }
  return <>{children}</>;
}

export const enlaceBoton = 'inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold';
