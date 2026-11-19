// Cola offline: ventas, cobros y gastos se guardan primero en el teléfono y se
// envían al servidor cuando hay señal. Cada registro lleva un id generado aquí,
// así que reenviar nunca duplica (el servidor responde "duplicada").
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { mensajeError } from './errores';
import { esTransitorio, type Enviado, type Pendiente } from './ruta';

interface EstadoCola { pendientes: Pendiente[]; enviados: Enviado[]; enviando: boolean; ultimoIntento: string | null }

const VACIO: EstadoCola = { pendientes: [], enviados: [], enviando: false, ultimoIntento: null };
const MAX_ENVIADOS = 60;
const FUNCION: Record<Pendiente['tipo'], string> = {
  venta: 'registrar_venta_offline',
  pago: 'registrar_pago',
  gasto: 'registrar_gasto'
};

let uid: string | null = null;
let estado: EstadoCola = VACIO;
const oyentes = new Set<() => void>();

// La cola es de cada usuario: si otra persona entra en el mismo teléfono,
// no se envían registros ajenos a su nombre.
const clave = (u: string) => `guva.cola.v1.${u}`;

function leer(u: string): EstadoCola {
  try {
    const t = localStorage.getItem(clave(u));
    if (!t) return VACIO;
    const o = JSON.parse(t) as Partial<EstadoCola>;
    return { ...VACIO, pendientes: o.pendientes ?? [], enviados: o.enviados ?? [] };
  } catch {
    return VACIO;
  }
}

/** Guarda en el teléfono. Devuelve false si el almacenamiento falló (lleno o bloqueado). */
function fijar(nuevo: EstadoCola): boolean {
  estado = nuevo;
  let ok = true;
  if (uid) {
    try {
      localStorage.setItem(clave(uid), JSON.stringify({ pendientes: nuevo.pendientes, enviados: nuevo.enviados }));
    } catch {
      ok = false;
    }
  }
  oyentes.forEach(f => f());
  return ok;
}

/** Carga la cola del usuario. No notifica: se llama durante el primer render del marco. */
export function iniciarCola(usuario: string | null) {
  if (usuario === uid) return;
  uid = usuario;
  estado = usuario ? leer(usuario) : VACIO;
}

export function estadoCola() { return estado; }

export function useCola() {
  return useSyncExternalStore(f => { oyentes.add(f); return () => { oyentes.delete(f); }; }, () => estado);
}

/**
 * Agrega un registro a la cola y trata de enviarlo de inmediato.
 * Lanza error si no se pudo guardar en el teléfono: en ese caso NO se registró nada.
 */
export function encolar(p: Omit<Pendiente, 'intentos' | 'creado'>) {
  if (!uid) throw new Error('No hay sesión activa');
  const nuevo: Pendiente = { ...p, intentos: 0, creado: new Date().toISOString() };
  const ok = fijar({ ...estado, pendientes: [...estado.pendientes, nuevo] });
  if (!ok) {
    fijar({ ...estado, pendientes: estado.pendientes.filter(x => x.id !== p.id) });
    throw new Error('No se pudo guardar en el teléfono (almacenamiento lleno o bloqueado). El registro no se guardó.');
  }
  void sincronizar();
}

function actualizar(id: string, cambios: Partial<Pendiente>) {
  fijar({ ...estado, pendientes: estado.pendientes.map(p => p.id === id ? { ...p, ...cambios } : p) });
}

function confirmar(p: Pendiente, respuesta: { folio?: string; total?: number } | null) {
  const env: Enviado = {
    id: p.id, tipo: p.tipo, folio: respuesta?.folio ?? '—',
    total: respuesta?.total != null ? Number(respuesta.total) : null,
    resumen: p.resumen, creado: p.creado, enviado: new Date().toISOString(), ticket: p.ticket
  };
  fijar({
    ...estado,
    pendientes: estado.pendientes.filter(x => x.id !== p.id),
    enviados: [env, ...estado.enviados.filter(x => x.id !== p.id)].slice(0, MAX_ENVIADOS)
  });
}

let enCurso: Promise<number> | null = null;
const alEnviar = new Set<(enviados: number) => void>();

/** Se llama con la cantidad enviada al terminar cada ronda con éxito (para refrescar datos). */
export function alTerminarEnvio(f: (enviados: number) => void) {
  alEnviar.add(f);
  return () => { alEnviar.delete(f); };
}

/** Envía los pendientes en orden. Una sola ronda a la vez. Devuelve cuántos se enviaron. */
export function sincronizar(): Promise<number> {
  if (enCurso) {
    // Algo se capturó durante la ronda: se envía al terminarla
    otraRonda = true;
    return enCurso;
  }
  enCurso = ronda().finally(() => {
    enCurso = null;
    if (otraRonda) { otraRonda = false; void sincronizar(); }
  });
  return enCurso;
}
let otraRonda = false;

async function ronda(): Promise<number> {
  const usuario = uid;
  if (!usuario || estado.pendientes.every(p => p.error)) return 0;
  fijar({ ...estado, enviando: true });
  let enviados = 0;
  try {
    for (const p of [...estado.pendientes]) {
      if (uid !== usuario) break;                                   // cambió el usuario a media ronda
      if (p.error || !estado.pendientes.some(x => x.id === p.id)) continue;
      let r: { data: unknown; error: unknown };
      try {
        r = await supabase.rpc(FUNCION[p.tipo], { p: p.datos });
      } catch (e) {
        r = { data: null, error: e };
      }
      if (uid !== usuario) break;
      if (r.error) {
        if (esTransitorio(r.error)) { actualizar(p.id, { intentos: p.intentos + 1 }); break; }
        actualizar(p.id, { intentos: p.intentos + 1, error: mensajeError(r.error) });
        continue;
      }
      confirmar(p, r.data as { folio?: string; total?: number } | null);
      enviados++;
    }
  } finally {
    if (uid === usuario) fijar({ ...estado, enviando: false, ultimoIntento: new Date().toISOString() });
  }
  if (enviados > 0) alEnviar.forEach(f => f(enviados));
  return enviados;
}

/** Quita la marca de error para volver a intentarlo (p. ej. después de que el admin corrigió un precio). */
export function reintentar(id: string) {
  actualizar(id, { error: undefined });
  void sincronizar();
}

/** Elimina un registro rechazado. El servidor no lo tiene (el rechazo deshace todo). */
export function descartar(id: string) {
  fijar({ ...estado, pendientes: estado.pendientes.filter(p => p.id !== id) });
}
