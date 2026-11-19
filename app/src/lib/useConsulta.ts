import { useCallback, useEffect, useState } from 'react';
import { mensajeError } from './errores';

/** Ejecuta una consulta a Supabase y expone datos, error y recarga. */
export function useConsulta<T>(consulta: () => PromiseLike<{ data: T | null; error: unknown }>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ejecutar = useCallback(consulta, deps);

  useEffect(() => {
    let vigente = true;
    setCargando(true);
    Promise.resolve(ejecutar()).then(({ data, error }) => {
      if (!vigente) return;
      setError(error ? mensajeError(error) : '');
      setDatos(error ? null : data);
      setCargando(false);
    }, e => { if (vigente) { setError(mensajeError(e)); setCargando(false); } });
    return () => { vigente = false; };
  }, [ejecutar, version]);

  return { datos, error, cargando, recargar: () => setVersion(v => v + 1) };
}
