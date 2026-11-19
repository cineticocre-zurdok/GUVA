// Tipos y cálculos puros de la venta en ruta (sin red ni almacenamiento: se prueban con vitest).
import type { ListaPrecio, MetodoPago, PrecioVigente } from './tipos';

export type TipoPendiente = 'venta' | 'pago' | 'gasto';

/** Datos para imprimir o compartir el comprobante aunque no haya señal. */
export interface Ticket {
  cliente: string;
  renglones: { nombre: string; cantidad: number; precio: number; descuento: number; importe: number }[];
  total: number;
  condicion: 'contado' | 'credito';
  metodo?: MetodoPago;
  recibido?: number;
  referencia?: string;
}

/** Registro capturado en el dispositivo que aún no confirma el servidor. */
export interface Pendiente {
  id: string;                         // id del documento (venta, cobro o gasto)
  tipo: TipoPendiente;
  datos: Record<string, unknown>;     // lo que recibe la función del servidor
  resumen: string;
  monto: number;                      // estimado en el dispositivo
  creado: string;
  intentos: number;
  error?: string;                     // rechazo del servidor: requiere atención
  ticket?: Ticket;
  /** Solo ventas: piezas que ya no están disponibles hasta sincronizar */
  piezas?: { producto_id: string; cantidad: number }[];
  /** Solo cobros: venta a la que se abona */
  ventaId?: string;
}

/** Registro que el servidor ya confirmó (se guardan los últimos para consulta). */
export interface Enviado {
  id: string;
  tipo: TipoPendiente;
  folio: string;
  total: number | null;               // total que decidió el servidor (ventas)
  resumen: string;
  creado: string;
  enviado: string;
  ticket?: Ticket;
}

export const redondear2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * ¿El error es de red o de sesión (se reintenta solo) o es un rechazo del
 * servidor (requiere atención)? Ante la duda se trata como transitorio:
 * reintentar es seguro porque cada registro lleva su propio id.
 */
export function esTransitorio(e: unknown, enLinea = typeof navigator === 'undefined' ? true : navigator.onLine): boolean {
  if (!enLinea) return true;
  if (!e) return false;
  const o = e as { message?: unknown; code?: unknown; status?: unknown };
  const m = String(o.message ?? e);
  const code = String(o.code ?? '');
  const status = Number(o.status ?? 0);
  if (status >= 500 || status === 401 || status === 408 || status === 429) return true;
  if (code === 'PGRST301' || code === 'PGRST303') return true;          // JWT vencido o inválido
  return /Failed to fetch|NetworkError|Load failed|network|timeout|timed out|JWT|Unexpected token|Bad Gateway|Service Unavailable|ECONN|aborted/i.test(m);
}

/** Existencia que el vendedor puede vender: lo del servidor menos lo vendido sin sincronizar. */
export function disponibles(existencias: { producto_id: string; cantidad: number }[], pendientes: Pendiente[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of existencias) m.set(e.producto_id, (m.get(e.producto_id) ?? 0) + e.cantidad);
  for (const p of pendientes) {
    if (p.tipo !== 'venta') continue;
    for (const r of p.piezas ?? []) m.set(r.producto_id, (m.get(r.producto_id) ?? 0) - r.cantidad);
  }
  return m;
}

export function precioDe(precios: PrecioVigente[], producto: string, lista: ListaPrecio): number | null {
  const p = precios.find(x => x.producto_id === producto && x.lista === lista);
  return p ? Number(p.precio) : null;
}

/** Descuento máximo que el servidor acepta del vendedor para un renglón. */
export const descuentoMaximo = (cantidad: number, precio: number, pct: number) =>
  redondear2(cantidad * precio * pct / 100);

export interface RenglonCarrito { producto_id: string; cantidad: number; precio: number; descuento: number }

export function totalesCarrito(rs: RenglonCarrito[]) {
  const subtotal = redondear2(rs.reduce((s, r) => s + r.cantidad * r.precio, 0));
  const descuento = redondear2(rs.reduce((s, r) => s + r.descuento, 0));
  return { subtotal, descuento, total: redondear2(subtotal - descuento) };
}

/** Saldo de una venta a crédito descontando los abonos que aún no se envían. */
export function saldoConPendientes(ventaId: string, saldo: number, pendientes: Pendiente[]): number {
  const abonado = pendientes.filter(p => p.tipo === 'pago' && p.ventaId === ventaId).reduce((s, p) => s + p.monto, 0);
  return redondear2(saldo - abonado);
}

/** Convierte texto capturado ("1,250.50", "$ 300") a número; NaN si no es válido. */
export function leerMonto(texto: string): number {
  const t = texto.replace(/[$\s,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Number(t);
}
