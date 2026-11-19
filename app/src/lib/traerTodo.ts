/** Supabase devuelve como máximo 1000 filas por consulta (max_rows). */
export const FILAS_POR_PAGINA = 1000;

interface ConsultaPaginable {
  range(desde: number, hasta: number): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Trae TODAS las filas de una consulta, de 1000 en 1000, para que listas largas
 * (catálogo, precios, existencias) no se corten sin aviso.
 * `armar` debe crear la consulta desde cero en cada llamada y con un orden estable
 * (que termine en una columna única, p. ej. id), o las páginas pueden repetir u omitir filas.
 */
export async function traerTodo<T = unknown>(armar: () => ConsultaPaginable): Promise<{ data: T[] | null; error: unknown }> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += FILAS_POR_PAGINA) {
    const { data, error } = await armar().range(desde, desde + FILAS_POR_PAGINA - 1);
    if (error) return { data: null, error };
    const pagina = (data ?? []) as T[];
    filas.push(...pagina);
    if (pagina.length < FILAS_POR_PAGINA) return { data: filas, error: null };
  }
}
