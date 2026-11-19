import { describe, expect, it } from 'vitest';
import { leerCatalogoCsv, limpiarNumero, normalizarEncabezado } from './csv';

describe('normalizarEncabezado', () => {
  it('acepta acentos, mayúsculas y alias', () => {
    expect(normalizarEncabezado('Código de Barras')).toBe('codigo_barras');
    expect(normalizarEncabezado(' SKU ')).toBe('codigo_interno');
    expect(normalizarEncabezado('Precio Mayoreo')).toBe('precio_mayoreo');
    expect(normalizarEncabezado('Línea')).toBe('linea');
    expect(normalizarEncabezado('Color')).toBeNull();
  });
});

describe('limpiarNumero', () => {
  it('limpia formatos comunes de Excel', () => {
    expect(limpiarNumero('$1,234.50')).toBe('1234.50');
    expect(limpiarNumero('12,50')).toBe('12.50');
    expect(limpiarNumero('1,200')).toBe('1200');
    expect(limpiarNumero(' 8 ')).toBe('8');
    expect(limpiarNumero('')).toBe('');
    expect(limpiarNumero('abc')).toBeNull();
    expect(limpiarNumero('-5')).toBeNull();
  });
});

describe('leerCatalogoCsv', () => {
  it('lee CSV con punto y coma y BOM de Excel', () => {
    const r = leerCatalogoCsv('﻿Código;Nombre;Marca;Línea;Costo;Color\nA1;Prod;Kinder;Kinder;$10,50;rojo\n');
    expect(r.errores).toEqual([]);
    expect(r.filas).toEqual([{ codigo_interno: 'A1', nombre: 'Prod', marca: 'Kinder', linea: 'Kinder', costo: '10.50' }]);
    expect(r.columnasIgnoradas).toEqual(['Color']);
  });

  it('reporta columnas faltantes', () => {
    const r = leerCatalogoCsv('codigo,nombre\nA,B\n');
    expect(r.errores).toEqual(['Falta la columna obligatoria "marca"', 'Falta la columna obligatoria "linea"']);
  });

  it('reporta fila, número inválido y códigos repetidos', () => {
    const r = leerCatalogoCsv('codigo,nombre,marca,linea,piezas_por_empaque\nA,X,M,Kinder,12\nA,Y,M,Kinder,1.5\nB,,M,Kinder,\n');
    expect(r.errores).toEqual([
      'Fila 3: "1.5" no es un número válido en piezas_por_empaque',
      'Fila 3: código A repetido (ya está en la fila 2)',
      'Fila 4: falta nombre'
    ]);
  });
});
