import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { leerCatalogoCsv, PLANTILLA_CSV, type FilaCatalogo } from '../../lib/csv';
import { Aviso, Boton, Encabezado, Tabla, Tarjeta } from '../../ui/ui';

interface Resumen { filas: number; creados: number; actualizados: number; precios_registrados: number }

export function ImportarCatalogo() {
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [filas, setFilas] = useState<(FilaCatalogo & { n: number })[]>([]);
  const [errores, setErrores] = useState<string[]>([]);
  const [ignoradas, setIgnoradas] = useState<string[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [errorServidor, setErrorServidor] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function leer(archivo: File) {
    setResumen(null); setErrorServidor(''); setNombreArchivo(archivo.name);
    if (/\.xlsx?$/i.test(archivo.name)) {
      setFilas([]); setIgnoradas([]);
      setErrores(['Este es un archivo de Excel. En Excel usa Archivo → Guardar como → "CSV UTF-8 (delimitado por comas)" y súbelo de nuevo.']);
      return;
    }
    const r = leerCatalogoCsv(await archivo.text());
    setFilas(r.filas.map((f, i) => ({ ...f, n: i + 2 })));
    setErrores(r.errores);
    setIgnoradas(r.columnasIgnoradas);
  }

  async function importar() {
    setEnviando(true); setErrorServidor('');
    const { data, error } = await supabase.rpc('importar_productos', {
      p_filas: filas.map(({ n: _n, ...f }) => f),
      p_motivo: `Importación ${nombreArchivo}`
    });
    setEnviando(false);
    if (error) setErrorServidor(mensajeError(error));
    else { setResumen(data as Resumen); setFilas([]); }
  }

  function descargarPlantilla() {
    const url = URL.createObjectURL(new Blob(['﻿' + PLANTILLA_CSV], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'plantilla_catalogo_guva.csv' });
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <>
      <Encabezado titulo="Importar catálogo" detalle="Crea o actualiza productos y precios desde un archivo CSV"
        acciones={<Link to="/catalogo" className="text-sm font-semibold text-cacao-600 underline">Volver al catálogo</Link>} />

      <Tarjeta className="mb-4 space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-cacao-800">
          <li>Descarga la plantilla y llénala con la lista real de Ferrero. Columnas obligatorias: <b>codigo_interno, nombre, marca, linea</b>.</li>
          <li>Línea debe ser una de: Ferrero, Kinder, Vualá, Gomitas. Precios por pieza; vacíos = no se cambian.</li>
          <li>Si un código interno ya existe, el producto se actualiza. Cada precio distinto queda en el historial.</li>
          <li>Si hay un solo error, no se importa nada: corriges el archivo y lo vuelves a subir.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" onClick={descargarPlantilla}>Descargar plantilla</Boton>
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-cacao-800 px-4 text-sm font-semibold text-white">
            Elegir archivo CSV
            <input type="file" accept=".csv,text/csv,.xlsx,.xls" className="hidden"
                   onChange={e => { const a = e.target.files?.[0]; if (a) leer(a); e.target.value = ''; }} />
          </label>
        </div>
      </Tarjeta>

      {resumen && (
        <Aviso tipo="exito">
          Importación completa: {resumen.filas} filas · {resumen.creados} productos nuevos · {resumen.actualizados} actualizados · {resumen.precios_registrados} precios registrados.
        </Aviso>
      )}
      {errorServidor && <Aviso tipo="error">El servidor rechazó la importación, no se guardó nada: {errorServidor}</Aviso>}

      {errores.length > 0 && (
        <Aviso tipo="error">
          <p className="mb-1 font-semibold">{nombreArchivo}: corrige estos puntos antes de importar</p>
          <ul className="list-disc pl-5">{errores.slice(0, 30).map(e => <li key={e}>{e}</li>)}</ul>
          {errores.length > 30 && <p>…y {errores.length - 30} más.</p>}
        </Aviso>
      )}

      {filas.length > 0 && errores.length === 0 && (
        <Tarjeta className="mt-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm"><b>{filas.length}</b> productos listos en {nombreArchivo}
              {ignoradas.length > 0 && <span className="text-cacao-600"> · columnas ignoradas: {ignoradas.join(', ')}</span>}</p>
            <Boton onClick={importar} cargando={enviando}>Importar {filas.length} productos</Boton>
          </div>
          <Tabla filas={filas.slice(0, 50)} llave={f => String(f.n)} columnas={[
            { titulo: 'Producto', celda: f => f.nombre },
            { titulo: 'Código', celda: f => f.codigo_interno },
            { titulo: 'Línea', celda: f => f.linea },
            { titulo: 'Costo', derecha: true, celda: f => f.costo || '—' },
            { titulo: 'Mayoreo', derecha: true, celda: f => f.precio_mayoreo || '—' },
            { titulo: 'Detalle', derecha: true, celda: f => f.precio_detalle || '—' }
          ]} />
          {filas.length > 50 && <p className="mt-2 text-xs text-cacao-600">Vista previa de las primeras 50 filas.</p>}
        </Tarjeta>
      )}
    </>
  );
}
