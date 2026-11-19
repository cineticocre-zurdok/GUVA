import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Producto } from '../lib/tipos';
import { Entrada } from './ui';

/** Buscador por nombre o código; Enter con un código de barras exacto (lector) agrega directo. */
export function BuscadorProducto({ productos, alElegir, detalle, placeholder = 'Buscar producto o escanear código', autoFocus }: {
  productos: Producto[];
  alElegir: (p: Producto) => void;
  detalle?: (p: Producto) => ReactNode;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [busqueda, setBusqueda] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  const sugerencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return productos.filter(p => p.nombre.toLowerCase().includes(q) || p.codigo_interno.toLowerCase().includes(q)
      || p.codigo_barras === busqueda.trim()).slice(0, 8);
  }, [busqueda, productos]);

  function elegir(p: Producto) {
    alElegir(p);
    setBusqueda('');
    campo.current?.focus();
  }

  function alTecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = busqueda.trim();
    const exacto = productos.find(p => p.codigo_barras === t || p.codigo_interno === t);
    if (exacto) elegir(exacto); else if (sugerencias.length === 1) elegir(sugerencias[0]);
  }

  return (
    <div className="relative">
      <Entrada ref={campo} autoFocus={autoFocus} placeholder={placeholder} value={busqueda} inputMode="search"
               aria-label="Buscar producto" onChange={e => setBusqueda(e.target.value)} onKeyDown={alTecla} />
      {sugerencias.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-cacao-200">
          {sugerencias.map(p => (
            <li key={p.id}>
              <button type="button" onClick={() => elegir(p)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-cacao-50">
                <span>{p.nombre} {p.presentacion && <span className="text-cacao-600">· {p.presentacion}</span>}</span>
                <span className="shrink-0 text-sm text-cacao-600">{detalle ? detalle(p) : p.codigo_interno}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
