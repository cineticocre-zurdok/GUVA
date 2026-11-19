/** Convierte un error de Supabase o de red en un mensaje claro en español. */
export function mensajeError(e: unknown): string {
  if (!e) return 'Error desconocido';
  const m = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.';
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/JWT expired/i.test(m)) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  if (/permission denied/i.test(m)) return 'No tienes permiso para esta operación.';
  return m;
}
