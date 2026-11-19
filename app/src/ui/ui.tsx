import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-cacao-800 text-white hover:bg-cacao-900 disabled:bg-cacao-400',
  secundario: 'bg-white text-cacao-800 ring-1 ring-cacao-200 hover:bg-cacao-100 disabled:text-cacao-400',
  peligro: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
  fantasma: 'text-cacao-600 hover:bg-cacao-100'
};

export function Boton({ variante = 'primario', grande, className, cargando, children, disabled, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; grande?: boolean; cargando?: boolean }) {
  return (
    <button
      {...p}
      disabled={disabled || cargando}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        grande ? 'min-h-14 px-6 text-lg' : 'min-h-11 px-4 text-sm',
        VARIANTES[variante], className
      )}
    >
      {cargando ? 'Procesando…' : children}
    </button>
  );
}

// La ayuda queda fuera de <label> para que el nombre accesible del campo sea solo la etiqueta
export function Campo({ etiqueta, ayuda, error, children }: { etiqueta: string; ayuda?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-cacao-800">{etiqueta}</span>
        {children}
      </label>
      {ayuda && !error && <p className="mt-1 text-xs text-cacao-600">{ayuda}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

const baseInput = 'w-full min-h-11 rounded-xl border border-cacao-200 bg-white px-3 text-base outline-none focus:border-ambar-500 focus:ring-2 focus:ring-ambar-400/40 disabled:bg-cacao-100';

// En React 19 `ref` llega como prop normal
export const Entrada = ({ className, ...p }: ComponentProps<'input'>) =>
  <input {...p} className={cx(baseInput, className)} />;

export const Selector = ({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select {...p} className={cx(baseInput, className)}>{children}</select>;

export const Tarjeta = ({ className, children }: { className?: string; children: ReactNode }) =>
  <section className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-cacao-100 md:p-5', className)}>{children}</section>;

export function Encabezado({ titulo, detalle, acciones }: { titulo: string; detalle?: string; acciones?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-cacao-900">{titulo}</h1>
        {detalle && <p className="text-sm text-cacao-600">{detalle}</p>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </header>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'error' | 'exito' | 'alerta'; children: ReactNode }) {
  const estilos = {
    info: 'bg-cacao-100 text-cacao-800',
    error: 'bg-red-50 text-red-800 ring-1 ring-red-200',
    exito: 'bg-green-50 text-green-800 ring-1 ring-green-200',
    alerta: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200'
  }[tipo];
  return <div role={tipo === 'error' ? 'alert' : 'status'} className={cx('rounded-xl px-4 py-3 text-sm', estilos)}>{children}</div>;
}

export function Insignia({ children, tono = 'neutro' }: { children: ReactNode; tono?: 'neutro' | 'alerta' | 'ok' | 'demo' }) {
  const t = { neutro: 'bg-cacao-100 text-cacao-800', alerta: 'bg-red-100 text-red-800', ok: 'bg-green-100 text-green-800', demo: 'bg-violet-100 text-violet-800' }[tono];
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-semibold', t)}>{children}</span>;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-cacao-600">{children}</p>;
}

export function Cargando() {
  return <p className="py-10 text-center text-sm text-cacao-600">Cargando…</p>;
}

/** Tabla en escritorio que se vuelve lista de tarjetas en celular. */
export function Tabla<T>({ filas, columnas, llave, alTocar }: {
  filas: T[];
  llave: (f: T) => string;
  columnas: { titulo: string; celda: (f: T) => ReactNode; derecha?: boolean; ocultarMovil?: boolean }[];
  alTocar?: (f: T) => void;
}) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-cacao-100 text-left text-xs uppercase tracking-wide text-cacao-600">
              {columnas.map(c => <th key={c.titulo} className={cx('px-3 py-2 font-semibold', c.derecha && 'text-right')}>{c.titulo}</th>)}
            </tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={llave(f)} onClick={alTocar ? () => alTocar(f) : undefined}
                  className={cx('border-b border-cacao-50', alTocar && 'cursor-pointer hover:bg-cacao-50')}>
                {columnas.map(c => <td key={c.titulo} className={cx('px-3 py-2.5', c.derecha && 'num text-right')}>{c.celda(f)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-cacao-100 md:hidden">
        {filas.map(f => (
          <li key={llave(f)} onClick={alTocar ? () => alTocar(f) : undefined}
              className={cx('py-3', alTocar && 'cursor-pointer active:bg-cacao-50')}>
            {columnas.filter(c => !c.ocultarMovil).map((c, i) => (
              <div key={c.titulo} className={cx('flex justify-between gap-3', i === 0 ? 'font-semibold' : 'text-sm')}>
                {i > 0 && <span className="text-cacao-600">{c.titulo}</span>}
                <span className={cx(c.derecha && 'num', i === 0 && 'w-full')}>{c.celda(f)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Panel modal simple; en celular ocupa la pantalla. */
export function Panel({ titulo, abierto, alCerrar, children }: { titulo: string; abierto: boolean; alCerrar: () => void; children: ReactNode }) {
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={alCerrar}>
      <div role="dialog" aria-modal="true" aria-label={titulo}
           className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 md:max-w-xl md:rounded-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button onClick={alCerrar} className="rounded-lg px-3 py-1 text-cacao-600 hover:bg-cacao-100" aria-label="Cerrar">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
