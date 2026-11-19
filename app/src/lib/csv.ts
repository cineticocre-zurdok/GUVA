import Papa from 'papaparse';

export const COLUMNAS_CATALOGO = [
  'codigo_interno', 'codigo_barras', 'nombre', 'marca', 'linea', 'presentacion',
  'unidad_medida', 'piezas_por_empaque', 'stock_minimo', 'costo', 'precio_detalle', 'precio_mayoreo'
] as const;
export type ColumnaCatalogo = (typeof COLUMNAS_CATALOGO)[number];
export type FilaCatalogo = Partial<Record<ColumnaCatalogo, string>>;

const OBLIGATORIAS: ColumnaCatalogo[] = ['codigo_interno', 'nombre', 'marca', 'linea'];
const NUMERICAS: ColumnaCatalogo[] = ['costo', 'precio_detalle', 'precio_mayoreo'];
const ENTERAS: ColumnaCatalogo[] = ['piezas_por_empaque', 'stock_minimo'];

// Nombres alternativos que la gente suele poner en Excel
const ALIAS: Record<string, ColumnaCatalogo> = {
  codigo: 'codigo_interno', clave: 'codigo_interno', sku: 'codigo_interno', codigo_interno: 'codigo_interno',
  codigo_de_barras: 'codigo_barras', ean: 'codigo_barras', upc: 'codigo_barras', codigo_barras: 'codigo_barras',
  nombre: 'nombre', nombre_comercial: 'nombre', producto: 'nombre', descripcion: 'nombre',
  marca: 'marca', linea: 'linea', presentacion: 'presentacion',
  unidad: 'unidad_medida', unidad_de_medida: 'unidad_medida', unidad_medida: 'unidad_medida',
  piezas_por_empaque: 'piezas_por_empaque', piezas_por_caja: 'piezas_por_empaque', pzas_caja: 'piezas_por_empaque',
  stock_minimo: 'stock_minimo', minimo: 'stock_minimo',
  costo: 'costo', costo_compra: 'costo', costo_de_compra: 'costo', costo_ferrero: 'costo',
  precio_detalle: 'precio_detalle', detalle: 'precio_detalle', precio_de_detalle: 'precio_detalle',
  precio_mayoreo: 'precio_mayoreo', mayoreo: 'precio_mayoreo', precio_de_mayoreo: 'precio_mayoreo',
  precio_preferencial: 'precio_mayoreo'
};

export function normalizarEncabezado(h: string): ColumnaCatalogo | null {
  const k = h
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return ALIAS[k] ?? null;
}

/** "$1,234.50" -> "1234.50" · "12,50" -> "12.50" · "" -> "" · texto inválido -> null */
export function limpiarNumero(v: string): string | null {
  let s = v.replace(/[$\s]/g, '');
  if (s === '') return '';
  if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,(?=\d{3}(\D|$))/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

export interface ResultadoCsv {
  filas: FilaCatalogo[];
  errores: string[];
  columnasIgnoradas: string[];
}

export function leerCatalogoCsv(texto: string): ResultadoCsv {
  const errores: string[] = [];
  const parsed = Papa.parse<Record<string, string>>(texto.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t']
  });

  const mapa = new Map<string, ColumnaCatalogo>();
  const columnasIgnoradas: string[] = [];
  for (const h of parsed.meta.fields ?? []) {
    const c = normalizarEncabezado(h);
    if (c) mapa.set(h, c); else if (h.trim()) columnasIgnoradas.push(h);
  }
  const presentes = new Set(mapa.values());
  for (const o of OBLIGATORIAS) if (!presentes.has(o)) errores.push(`Falta la columna obligatoria "${o}"`);
  if (errores.length) return { filas: [], errores, columnasIgnoradas };

  const filas: FilaCatalogo[] = [];
  const vistos = new Map<string, number>();
  parsed.data.forEach((raw, i) => {
    const n = i + 2; // fila 1 = encabezados
    const f: FilaCatalogo = {};
    for (const [h, c] of mapa) f[c] = (raw[h] ?? '').trim();
    for (const o of OBLIGATORIAS) if (!f[o]) errores.push(`Fila ${n}: falta ${o}`);
    for (const c of [...NUMERICAS, ...ENTERAS]) {
      if (f[c] === undefined) continue;
      const limpio = limpiarNumero(f[c]!);
      if (limpio === null || (ENTERAS.includes(c) && limpio.includes('.'))) {
        errores.push(`Fila ${n}: "${f[c]}" no es un número válido en ${c}`);
      } else f[c] = limpio;
    }
    if (f.codigo_interno) {
      const previa = vistos.get(f.codigo_interno);
      if (previa) errores.push(`Fila ${n}: código ${f.codigo_interno} repetido (ya está en la fila ${previa})`);
      vistos.set(f.codigo_interno, n);
    }
    filas.push(f);
  });
  if (filas.length === 0) errores.push('El archivo no tiene filas de productos');
  return { filas, errores, columnasIgnoradas };
}

export const PLANTILLA_CSV =
  COLUMNAS_CATALOGO.join(',') + '\n' +
  // Fila de ejemplo con valores de relleno: se reemplaza por datos reales antes de importar
  'EJEMPLO-001,,NOMBRE DEL PRODUCTO,Kinder,Kinder,PRESENTACION,pieza,1,0,,,\n';
