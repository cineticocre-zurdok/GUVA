import { useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import { traerTodo } from '../../lib/traerTodo';
import { dinero } from '../../lib/formato';
import { leerMonto } from '../../lib/ruta';
import { NOMBRE_LISTA, type Cliente, type SaldoVenta } from '../../lib/tipos';
import { Aviso, Boton, Campo, Cargando, Encabezado, Entrada, Insignia, Panel, Selector, Tabla, Tarjeta, Vacio } from '../../ui/ui';

interface Edicion {
  id: string | null; nombre: string; tipo: 'detalle' | 'distribuidor'; telefono: string; direccion: string;
  lista_precio: Cliente['lista_precio']; permite_credito: boolean; limite_credito: string; dias_credito: string; activo: boolean;
}

const nuevo = (): Edicion => ({
  id: null, nombre: '', tipo: 'detalle', telefono: '', direccion: '', lista_precio: 'detalle',
  permite_credito: false, limite_credito: '0', dias_credito: '0', activo: true
});

export function Clientes() {
  const clientes = useConsulta(() => traerTodo<Cliente>(() => supabase.from('clientes').select('*').order('nombre').order('id')), []);
  const saldos = useConsulta(() => traerTodo<SaldoVenta>(() => supabase.from('v_saldos_ventas').select('*').gt('saldo', 0).order('venta_id')), []);
  const [ed, setEd] = useState<Edicion | null>(null);
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const saldoDe = (id: string) => ((saldos.datos ?? []) as SaldoVenta[]).filter(s => s.cliente_id === id).reduce((s, x) => s + Number(x.saldo), 0);
  const vencido = (id: string) => ((saldos.datos ?? []) as SaldoVenta[]).some(s => s.cliente_id === id && s.vencida);
  const lista = ((clientes.datos ?? []) as Cliente[]).filter(c => !texto || c.nombre.toLowerCase().includes(texto.toLowerCase()));

  function editar(c: Cliente) {
    if (c.tipo === 'mostrador') return;
    setError('');
    setEd({ id: c.id, nombre: c.nombre, tipo: c.tipo, telefono: c.telefono ?? '', direccion: c.direccion ?? '',
            lista_precio: c.lista_precio, permite_credito: c.permite_credito, limite_credito: String(c.limite_credito),
            dias_credito: String(c.dias_credito), activo: c.activo });
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!ed) return;
    const limite = leerMonto(ed.limite_credito || '0');
    const dias = parseInt(ed.dias_credito || '0', 10);
    if (!ed.nombre.trim()) return setError('El nombre es obligatorio.');
    if (Number.isNaN(limite)) return setError('Límite de crédito inválido.');
    if (Number.isNaN(dias) || dias < 0 || dias > 60) return setError('Los días de crédito van de 0 a 60.');
    if (ed.permite_credito && (limite <= 0 || dias <= 0)) return setError('Para dar crédito, captura un límite y días mayores a cero.');
    const fila = {
      nombre: ed.nombre.trim(), tipo: ed.tipo, telefono: ed.telefono.trim() || null, direccion: ed.direccion.trim() || null,
      lista_precio: ed.lista_precio, permite_credito: ed.permite_credito,
      limite_credito: ed.permite_credito ? limite : 0, dias_credito: ed.permite_credito ? dias : 0, activo: ed.activo
    };
    setError(''); setGuardando(true);
    const { error } = ed.id
      ? await supabase.from('clientes').update(fila).eq('id', ed.id)
      : await supabase.from('clientes').insert(fila);
    setGuardando(false);
    if (error) return setError(mensajeError(error));
    setEd(null); clientes.recargar();
  }

  const cambia = <K extends keyof Edicion>(k: K, v: Edicion[K]) => setEd(x => x && { ...x, [k]: v });

  return (
    <>
      <Encabezado titulo="Clientes" detalle="Lista de precios y crédito de cada cliente"
        acciones={<Boton onClick={() => { setError(''); setEd(nuevo()); }}>Nuevo cliente</Boton>} />
      <Tarjeta>
        <Entrada className="mb-3" placeholder="Buscar cliente" value={texto} onChange={e => setTexto(e.target.value)} />
        {clientes.error && <Aviso tipo="error">{clientes.error}</Aviso>}
        {clientes.cargando ? <Cargando /> : lista.length === 0 ? <Vacio>Sin clientes.</Vacio> : (
          <Tabla filas={lista} llave={c => c.id} alTocar={editar} columnas={[
            { titulo: 'Cliente', celda: c => <>{c.nombre} {!c.activo && <Insignia>Inactivo</Insignia>} {c.es_demo && <Insignia tono="demo">Prueba</Insignia>}</> },
            { titulo: 'Tipo', celda: c => c.tipo, ocultarMovil: true },
            { titulo: 'Lista', celda: c => NOMBRE_LISTA[c.lista_precio] },
            { titulo: 'Crédito', celda: c => c.permite_credito ? `${dinero(c.limite_credito)} · ${c.dias_credito} días` : '—', ocultarMovil: true },
            { titulo: 'Saldo', derecha: true, celda: c => { const s = saldoDe(c.id); return s ? <b className={vencido(c.id) ? 'text-red-700' : ''}>{dinero(s)}</b> : '—'; } }
          ]} />
        )}
        <p className="mt-3 text-xs text-cacao-600">"Venta de mostrador" es el cliente genérico para ventas sin identificar; no se edita.</p>
      </Tarjeta>

      <Panel titulo={ed?.id ? 'Editar cliente' : 'Nuevo cliente'} abierto={!!ed} alCerrar={() => setEd(null)}>
        {ed && (
          <form onSubmit={guardar} className="space-y-3">
            <Campo etiqueta="Nombre o negocio"><Entrada autoFocus value={ed.nombre} onChange={e => cambia('nombre', e.target.value)} /></Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Tipo">
                <Selector value={ed.tipo} onChange={e => cambia('tipo', e.target.value as Edicion['tipo'])}>
                  <option value="detalle">Detalle (tienda)</option>
                  <option value="distribuidor">Distribuidor</option>
                </Selector>
              </Campo>
              <Campo etiqueta="Lista de precios">
                <Selector value={ed.lista_precio} onChange={e => cambia('lista_precio', e.target.value as Edicion['lista_precio'])}>
                  {(['detalle', 'mayoreo', 'especial'] as const).map(l => <option key={l} value={l}>{NOMBRE_LISTA[l]}</option>)}
                </Selector>
              </Campo>
            </div>
            <Campo etiqueta="Teléfono"><Entrada inputMode="tel" value={ed.telefono} onChange={e => cambia('telefono', e.target.value)} /></Campo>
            <Campo etiqueta="Dirección"><Entrada value={ed.direccion} onChange={e => cambia('direccion', e.target.value)} /></Campo>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={ed.permite_credito} onChange={e => cambia('permite_credito', e.target.checked)} /> Permite crédito
            </label>
            {ed.permite_credito && (
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Límite de crédito"><Entrada inputMode="decimal" value={ed.limite_credito} onChange={e => cambia('limite_credito', e.target.value)} /></Campo>
                <Campo etiqueta="Días de crédito (máx. 60)"><Entrada inputMode="numeric" value={ed.dias_credito} onChange={e => cambia('dias_credito', e.target.value.replace(/\D/g, ''))} /></Campo>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ed.activo} onChange={e => cambia('activo', e.target.checked)} /> Activo
            </label>
            {ed.lista_precio === 'especial' && <Aviso tipo="alerta">La lista "Especial" requiere que cada producto tenga precio especial registrado; si falta, la venta se rechaza.</Aviso>}
            {error && <Aviso tipo="error">{error}</Aviso>}
            <Boton type="submit" className="w-full" cargando={guardando}>Guardar</Boton>
          </form>
        )}
      </Panel>
    </>
  );
}
