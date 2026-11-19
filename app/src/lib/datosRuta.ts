// Copia local de lo que el vendedor necesita para vender sin señal:
// su jornada, catálogo, precios de venta, su existencia, clientes y saldos.
// Se refresca al abrir la app, al volver la señal y después de cada envío.
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { mensajeError } from './errores';
import { traerTodo } from './traerTodo';
import type { Cliente, Configuracion, Jornada, PrecioVigente, Producto, SaldoVenta } from './tipos';

export interface DatosRuta {
  uid: string;
  actualizado: string;
  ubicacionId: string | null;
  jornada: Jornada | null;          // activa: preparación, abierta o en cierre
  productos: Producto[];
  precios: PrecioVigente[];
  existencias: { producto_id: string; cantidad: number }[];
  clientes: Cliente[];
  saldos: SaldoVenta[];             // ventas a crédito propias con saldo
  config: Configuracion | null;
}

interface Estado { datos: DatosRuta | null; cargando: boolean; error: string }

let estado: Estado = { datos: null, cargando: false, error: '' };
const oyentes = new Set<() => void>();
const clave = (u: string) => `guva.ruta.v1.${u}`;

function fijar(e: Estado) { estado = e; oyentes.forEach(f => f()); }

export function useDatosRuta() {
  return useSyncExternalStore(f => { oyentes.add(f); return () => { oyentes.delete(f); }; }, () => estado);
}

/** Carga la última copia guardada en el teléfono (sin red). */
export function iniciarDatosRuta(uid: string | null) {
  if (estado.datos?.uid === uid) return;
  let datos: DatosRuta | null = null;
  if (uid) {
    try {
      const t = localStorage.getItem(clave(uid));
      if (t) datos = JSON.parse(t) as DatosRuta;
    } catch { /* copia dañada: se vuelve a descargar */ }
  }
  estado = { datos, cargando: false, error: '' };
}

const de = <T,>(r: { data: unknown; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

let enCurso: Promise<void> | null = null;

export function refrescarDatosRuta(uid: string): Promise<void> {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    fijar({ ...estado, cargando: true });
    try {
      const [ubic, jornada, productos, precios, clientes, saldos, config] = await Promise.all([
        supabase.from('ubicaciones').select('id').eq('vendedor_id', uid).eq('activo', true).maybeSingle(),
        supabase.from('jornadas_ruta').select('*').eq('vendedor_id', uid)
          .in('estado', ['preparacion', 'abierta', 'en_cierre']).maybeSingle(),
        traerTodo<Producto>(() => supabase.from('productos').select('*').eq('activo', true).order('nombre').order('id')),
        traerTodo<PrecioVigente>(() => supabase.from('v_precios_vigentes').select('*').neq('lista', 'costo')
          .order('producto_id').order('lista')),
        traerTodo<Cliente>(() => supabase.from('clientes').select('*').eq('activo', true).order('nombre').order('id')),
        traerTodo<SaldoVenta>(() => supabase.from('v_saldos_ventas').select('*').eq('condicion', 'credito').gt('saldo', 0)
          .order('fecha_vencimiento').order('venta_id')),
        supabase.from('configuracion').select('*').single()
      ]);
      const ubicacionId = (de<{ id: string } | null>(ubic))?.id ?? null;
      const existencias = ubicacionId
        ? de<{ producto_id: string; cantidad: number }[]>(await traerTodo(() =>
            supabase.from('existencias').select('producto_id,cantidad').eq('ubicacion_id', ubicacionId).order('producto_id')))
        : [];
      const datos: DatosRuta = {
        uid, actualizado: new Date().toISOString(), ubicacionId,
        jornada: de<Jornada | null>(jornada),
        productos: de<Producto[]>(productos),
        precios: de<PrecioVigente[]>(precios),
        existencias,
        clientes: de<Cliente[]>(clientes),
        saldos: de<SaldoVenta[]>(saldos),
        config: de<Configuracion>(config)
      };
      try { localStorage.setItem(clave(uid), JSON.stringify(datos)); } catch { /* se queda solo en memoria */ }
      fijar({ datos, cargando: false, error: '' });
    } catch (e) {
      // Se conserva la copia anterior: se puede seguir vendiendo con ella
      fijar({ ...estado, cargando: false, error: mensajeError(e) });
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}
