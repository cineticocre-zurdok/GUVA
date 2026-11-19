/** UUID v4 generado en el dispositivo: hace idempotente la sincronización. */
export function nuevoId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Respaldo para navegadores sin randomUUID (o fuera de https)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Identificador fijo de este teléfono o PC (queda en cada venta). */
export function idDispositivo(): string {
  const CLAVE = 'guva.dispositivo';
  try {
    let id = localStorage.getItem(CLAVE);
    if (!id) { id = nuevoId(); localStorage.setItem(CLAVE, id); }
    return id;
  } catch {
    return 'sin-almacenamiento';
  }
}
