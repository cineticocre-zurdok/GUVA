const mxn = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const entero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const fechaHora = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short'
});

export const dinero = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === '' ? '—' : mxn.format(Number(n));

export const piezas = (n: number | null | undefined) => (n == null ? '—' : entero.format(n));

export const fecha = (iso: string | null | undefined) => (iso ? fechaHora.format(new Date(iso)) : '—');

/** Fecha operativa de hoy en la hora del centro de México (AAAA-MM-DD). */
export const hoyMexico = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
