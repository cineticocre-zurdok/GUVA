import { useState, type FormEvent } from 'react';
import { encolar } from '../../lib/cola';
import { nuevoId } from '../../lib/id';
import { dinero, hoyMexico } from '../../lib/formato';
import { leerMonto } from '../../lib/ruta';
import { NOMBRE_GASTO, NOMBRE_METODO, type CategoriaGasto, type MetodoPago } from '../../lib/tipos';
import { Aviso, Boton, Campo, Encabezado, Entrada, Selector, Tarjeta } from '../../ui/ui';
import { ConJornadaAbierta } from './comun';

const CATEGORIAS: CategoriaGasto[] = ['combustible', 'alimentacion_ruta', 'transporte', 'mantenimiento', 'operativo', 'otro'];

function FormGasto() {
  const [categoria, setCategoria] = useState<CategoriaGasto>('combustible');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('efectivo');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  function registrar(e: FormEvent) {
    e.preventDefault();
    setError(''); setOk('');
    const m = leerMonto(monto);
    if (!concepto.trim()) return setError('Describe el gasto (p. ej. "Gasolina, estación Centro").');
    if (Number.isNaN(m) || m <= 0) return setError('Captura un monto válido.');
    const id = nuevoId();
    try {
      encolar({
        id, tipo: 'gasto', monto: m, resumen: `Gasto · ${NOMBRE_GASTO[categoria]}`,
        datos: { id, categoria, concepto: concepto.trim(), monto: m, metodo, fecha: hoyMexico(), registrado_en: new Date().toISOString() }
      });
    } catch (err) {
      return setError(err instanceof Error ? err.message : String(err));
    }
    setOk(`Gasto de ${dinero(m)} guardado.`);
    setConcepto(''); setMonto('');
  }

  return (
    <Tarjeta className="max-w-lg">
      <form onSubmit={registrar} className="space-y-3">
        <Campo etiqueta="Categoría">
          <Selector value={categoria} onChange={e => setCategoria(e.target.value as CategoriaGasto)}>
            {CATEGORIAS.map(c => <option key={c} value={c}>{NOMBRE_GASTO[c]}</option>)}
          </Selector>
        </Campo>
        <Campo etiqueta="Concepto"><Entrada value={concepto} onChange={e => setConcepto(e.target.value)} /></Campo>
        <Campo etiqueta="Monto"><Entrada inputMode="decimal" value={monto} onChange={e => setMonto(e.target.value)} /></Campo>
        <div className="grid grid-cols-2 gap-2">
          {(['efectivo', 'transferencia'] as const).map(m => (
            <Boton key={m} type="button" variante={metodo === m ? 'primario' : 'secundario'} aria-pressed={metodo === m}
                   onClick={() => setMetodo(m)}>{NOMBRE_METODO[m]}</Boton>
          ))}
        </div>
        <p className="text-xs text-cacao-600">Los gastos en efectivo se descuentan del efectivo que entregas al cerrar la ruta.</p>
        {error && <Aviso tipo="error">{error}</Aviso>}
        {ok && <Aviso tipo="exito">{ok}</Aviso>}
        <Boton type="submit" grande className="w-full">Registrar gasto</Boton>
      </form>
    </Tarjeta>
  );
}

export function Gasto() {
  return (
    <>
      <Encabezado titulo="Registrar gasto" detalle="Gasto de la ruta de hoy" />
      <ConJornadaAbierta><FormGasto /></ConJornadaAbierta>
    </>
  );
}
