import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { traerTodo } from '../../lib/traerTodo';
import { piezas } from '../../lib/formato';
import type { Producto } from '../../lib/tipos';
import { Aviso, Boton, Campo, Encabezado, Entrada, Tarjeta, Vacio } from '../../ui/ui';

interface Renglon { producto: Producto; cajas: string; sueltas: string }

const totalPiezas = (r: Renglon) =>
  (parseInt(r.cajas || '0', 10) || 0) * r.producto.piezas_por_empaque + (parseInt(r.sueltas || '0', 10) || 0);

export function NuevaEntrada() {
  const { datos } = useConsulta(() => traerTodo<Producto>(() =>
    supabase.from('productos').select('*').eq('activo', true).order('nombre').order('id')), []);
  const productos = (datos ?? []) as Producto[];
  const [busqueda, setBusqueda] = useState('');
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [referencia, setReferencia] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const [folio, setFolio] = useState('');
  const [enviando, setEnviando] = useState(false);
  const buscador = useRef<HTMLInputElement>(null);

  const sugerencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return productos.filter(p => p.nombre.toLowerCase().includes(q) || p.codigo_interno.toLowerCase().includes(q) || p.codigo_barras === q).slice(0, 8);
  }, [busqueda, productos]);

  function agregar(p: Producto) {
    setFolio('');
    setRenglones(rs => rs.some(r => r.producto.id === p.id) ? rs : [...rs, { producto: p, cajas: '', sueltas: '' }]);
    setBusqueda('');
    buscador.current?.focus();
  }

  // Enter con un código de barras exacto (lector o teclado) agrega directo
  function alEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const exacto = productos.find(p => p.codigo_barras === busqueda.trim() || p.codigo_interno === busqueda.trim());
    if (exacto) agregar(exacto); else if (sugerencias.length === 1) agregar(sugerencias[0]);
  }

  const cambia = (id: string, k: 'cajas' | 'sueltas', v: string) =>
    setRenglones(rs => rs.map(r => r.producto.id === id ? { ...r, [k]: v.replace(/\D/g, '') } : r));

  const total = renglones.reduce((s, r) => s + totalPiezas(r), 0);

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setError('');
    const lineas = renglones.map(r => ({ producto_id: r.producto.id, cantidad: totalPiezas(r) }));
    if (lineas.length === 0) return setError('Agrega al menos un producto.');
    if (lineas.some(l => l.cantidad <= 0)) return setError('Todos los productos deben tener cantidad mayor a cero.');
    if (!referencia.trim()) return setError('Captura la factura o remisión de Ferrero.');
    setEnviando(true);
    const { data, error } = await supabase.rpc('registrar_entrada', {
      p_referencia: referencia.trim(), p_renglones: lineas, p_notas: notas.trim() || null
    });
    setEnviando(false);
    if (error) return setError(mensajeError(error));
    setFolio(data as string);
    setRenglones([]); setReferencia(''); setNotas('');
  }

  return (
    <>
      <Encabezado titulo="Entrada de mercancía" detalle="Compra recibida de Ferrero a la bodega principal"
        acciones={<Link to="/inventario" className="text-sm font-semibold text-cacao-600 underline">Ver inventario</Link>} />
      {folio && <div className="mb-4"><Aviso tipo="exito">Entrada registrada con folio <b>{folio}</b>. La existencia de bodega ya está actualizada.</Aviso></div>}

      <form onSubmit={registrar} className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Tarjeta>
          <div className="relative mb-3">
            <Entrada ref={buscador} autoFocus placeholder="Buscar producto o escanear código de barras" value={busqueda}
                     onChange={e => setBusqueda(e.target.value)} onKeyDown={alEnter} inputMode="search" />
            {sugerencias.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-cacao-200">
                {sugerencias.map(p => (
                  <li key={p.id}>
                    <button type="button" onClick={() => agregar(p)} className="flex w-full justify-between px-3 py-3 text-left hover:bg-cacao-50">
                      <span>{p.nombre} {p.presentacion && <span className="text-cacao-600">· {p.presentacion}</span>}</span>
                      <span className="text-sm text-cacao-600">{p.codigo_interno}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {renglones.length === 0 ? <Vacio>Busca y agrega los productos que llegaron.</Vacio> : (
            <ul className="divide-y divide-cacao-100">
              {renglones.map(r => (
                <li key={r.producto.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 md:grid-cols-[1fr_110px_110px_90px_auto]">
                  <div>
                    <p className="font-semibold">{r.producto.nombre}</p>
                    <p className="text-xs text-cacao-600">{r.producto.codigo_interno} · {r.producto.piezas_por_empaque} pzas por empaque</p>
                  </div>
                  <button type="button" onClick={() => setRenglones(rs => rs.filter(x => x !== r))}
                          className="justify-self-end rounded-lg px-2 py-1 text-red-700 hover:bg-red-50 md:order-last" aria-label={`Quitar ${r.producto.nombre}`}>Quitar</button>
                  <Campo etiqueta="Empaques"><Entrada inputMode="numeric" value={r.cajas} onChange={e => cambia(r.producto.id, 'cajas', e.target.value)} /></Campo>
                  <Campo etiqueta="Piezas sueltas"><Entrada inputMode="numeric" value={r.sueltas} onChange={e => cambia(r.producto.id, 'sueltas', e.target.value)} /></Campo>
                  <p className="num col-span-2 text-right font-bold md:col-span-1">{piezas(totalPiezas(r))} pzas</p>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta className="space-y-3 self-start">
          <Campo etiqueta="Factura o remisión de Ferrero"><Entrada value={referencia} onChange={e => { setReferencia(e.target.value); setError(''); }} /></Campo>
          <Campo etiqueta="Notas (opcional)"><Entrada value={notas} onChange={e => setNotas(e.target.value)} /></Campo>
          <div className="flex justify-between border-t border-cacao-100 pt-3 text-sm">
            <span>{renglones.length} productos</span><span className="num font-bold">{piezas(total)} piezas</span>
          </div>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <Boton type="submit" grande className="w-full" cargando={enviando}>Registrar entrada</Boton>
          <p className="text-xs text-cacao-600">El costo de cada pieza se toma de la lista de costos vigente. Para cambiarlo, edita el producto en Catálogo.</p>
        </Tarjeta>
      </form>
    </>
  );
}
