import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { mensajeError } from '../lib/errores';
import { Aviso, Boton, Campo, Entrada } from '../ui/ui';

export function Ingreso() {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setError(''); setEnviando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: clave });
    setEnviando(false);
    if (error) setError(mensajeError(error));
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-cacao-800 p-4">
      <form onSubmit={entrar} className="w-full max-w-sm space-y-4 rounded-3xl bg-cacao-50 p-6 shadow-xl">
        <div className="mb-2 flex items-center gap-3">
          <img src="/icono.svg" alt="" className="h-12 w-12" />
          <div>
            <p className="text-2xl font-bold leading-none">GUVA</p>
            <p className="text-sm text-cacao-600">Distribución y control</p>
          </div>
        </div>
        <Campo etiqueta="Correo">
          <Entrada type="email" autoComplete="username" required value={correo} onChange={e => setCorreo(e.target.value)} />
        </Campo>
        <Campo etiqueta="Contraseña">
          <Entrada type="password" autoComplete="current-password" required value={clave} onChange={e => setClave(e.target.value)} />
        </Campo>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Boton type="submit" grande className="w-full" cargando={enviando}>Entrar</Boton>
      </form>
    </main>
  );
}
