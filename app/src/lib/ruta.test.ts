import { describe, expect, it } from 'vitest';
import { descuentoMaximo, disponibles, esTransitorio, leerMonto, precioDe, saldoConPendientes, totalesCarrito, type Pendiente } from './ruta';

const pend = (p: Partial<Pendiente>): Pendiente => ({
  id: 'x', tipo: 'venta', datos: {}, resumen: '', monto: 0, creado: '', intentos: 0, ...p
});

describe('esTransitorio', () => {
  it('sin señal siempre es transitorio', () => {
    expect(esTransitorio({ message: 'Existencia insuficiente' }, false)).toBe(true);
  });
  it('errores de red y de sesión se reintentan', () => {
    expect(esTransitorio({ message: 'TypeError: Failed to fetch' }, true)).toBe(true);
    expect(esTransitorio({ message: 'JWT expired', code: 'PGRST301' }, true)).toBe(true);
    expect(esTransitorio({ message: 'x', status: 503 }, true)).toBe(true);
  });
  it('rechazos de negocio requieren atención', () => {
    expect(esTransitorio({ message: 'Existencia insuficiente de "Kinder": hay 0, se requieren 2', code: 'P0001' }, true)).toBe(false);
    expect(esTransitorio({ message: 'No hay una jornada de ruta abierta para registrar la venta' }, true)).toBe(false);
  });
});

describe('disponibles', () => {
  it('resta lo vendido sin sincronizar e ignora cobros', () => {
    const m = disponibles(
      [{ producto_id: 'a', cantidad: 10 }, { producto_id: 'b', cantidad: 3 }],
      [pend({ piezas: [{ producto_id: 'a', cantidad: 4 }] }),
       pend({ id: 'y', piezas: [{ producto_id: 'a', cantidad: 1 }, { producto_id: 'b', cantidad: 3 }] }),
       pend({ id: 'z', tipo: 'pago', monto: 50 })]);
    expect(m.get('a')).toBe(5);
    expect(m.get('b')).toBe(0);
  });
});

describe('precios y totales', () => {
  const precios = [
    { producto_id: 'a', lista: 'detalle' as const, precio: 15, vigente_desde: '' },
    { producto_id: 'a', lista: 'mayoreo' as const, precio: 12, vigente_desde: '' }
  ];
  it('elige la lista del cliente', () => {
    expect(precioDe(precios, 'a', 'mayoreo')).toBe(12);
    expect(precioDe(precios, 'a', 'especial')).toBeNull();
  });
  it('suma sin errores de centavos', () => {
    const t = totalesCarrito([
      { producto_id: 'a', cantidad: 3, precio: 0.1, descuento: 0 },
      { producto_id: 'b', cantidad: 1, precio: 0.2, descuento: 0.05 }
    ]);
    expect(t).toEqual({ subtotal: 0.5, descuento: 0.05, total: 0.45 });
  });
  it('descuento máximo del vendedor', () => {
    expect(descuentoMaximo(3, 15, 10)).toBe(4.5);
    expect(descuentoMaximo(3, 15, 0)).toBe(0);
  });
});

describe('saldoConPendientes y leerMonto', () => {
  it('descuenta abonos en cola de la misma venta', () => {
    const ps = [pend({ tipo: 'pago', ventaId: 'v1', monto: 100 }), pend({ tipo: 'pago', ventaId: 'v2', monto: 30 })];
    expect(saldoConPendientes('v1', 250, ps)).toBe(150);
  });
  it('lee montos capturados', () => {
    expect(leerMonto('1,250.50')).toBe(1250.5);
    expect(leerMonto('$ 300')).toBe(300);
    expect(Number.isNaN(leerMonto('12.345'))).toBe(true);
    expect(Number.isNaN(leerMonto('abc'))).toBe(true);
  });
});
