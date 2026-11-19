import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { esTransitorio } from '../lib/ruta';
import type { Perfil, Rol } from '../lib/tipos';

interface EstadoSesion {
  sesion: Session | null;
  perfil: Perfil | null;
  /** Solo es true al abrir la app o al cambiar de usuario; nunca al renovar el token. */
  cargando: boolean;
  /** Hay sesión pero el administrador aún no asigna rol, o el perfil está inactivo */
  sinPerfil: boolean;
  /** No se pudo consultar el perfil (red o servidor) */
  errorPerfil: string;
  reintentar: () => void;
  salir: () => Promise<void>;
}

const Ctx = createContext<EstadoSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [sesionLista, setSesionLista] = useState(false);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  // Usuario cuyo perfil ya se consultó: evita recargar al renovar el token (~cada hora),
  // lo que antes desmontaba la app y borraba lo capturado.
  const [perfilDe, setPerfilDe] = useState<string | null>(null);
  const [errorPerfil, setErrorPerfil] = useState('');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSesion(data.session); setSesionLista(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => { setSesion(s); setSesionLista(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = sesion?.user.id ?? null;

  useEffect(() => {
    if (!uid) { setPerfil(null); setPerfilDe(null); setErrorPerfil(''); return; }
    let vigente = true;
    const claveCache = `guva.perfil.${uid}`;
    const desdeCache = (): Perfil | null => {
      try { return JSON.parse(localStorage.getItem(claveCache) ?? 'null') as Perfil | null; } catch { return null; }
    };
    Promise.resolve(supabase.from('perfiles').select('id,nombre,rol,activo').eq('id', uid).maybeSingle())
      .then(r => r, e => ({ data: null, error: e }))
      .then(({ data, error }) => {
        if (!vigente) return;
        const guardado = desdeCache();
        if (error && esTransitorio(error) && guardado) {
          // Sin señal: se abre con el último perfil conocido para poder vender en ruta
          setErrorPerfil(''); setPerfil(guardado);
        } else if (error) {
          setErrorPerfil(mensajeError(error)); setPerfil(null);
        } else {
          const p = data && data.activo ? (data as Perfil) : null;
          try { if (p) localStorage.setItem(claveCache, JSON.stringify(p)); else localStorage.removeItem(claveCache); } catch { /* sin almacenamiento */ }
          setErrorPerfil(''); setPerfil(p);
        }
        setPerfilDe(uid);
      });
    return () => { vigente = false; };
  }, [uid, intento]);

  const cargando = !sesionLista || (!!uid && perfilDe !== uid);

  const valor: EstadoSesion = {
    sesion, perfil, cargando, errorPerfil,
    sinPerfil: !!uid && !cargando && !perfil && !errorPerfil,
    reintentar: () => { setPerfilDe(null); setErrorPerfil(''); setIntento(i => i + 1); },
    salir: async () => { await supabase.auth.signOut(); }
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSesion() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSesion fuera de ProveedorSesion');
  return c;
}

export function useTieneRol(...roles: Rol[]) {
  const { perfil } = useSesion();
  return !!perfil && roles.includes(perfil.rol);
}
