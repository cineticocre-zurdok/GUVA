// Tipos que reflejan las tablas y vistas de supabase/migrations.
export type Rol = 'admin' | 'vendedor' | 'bodega' | 'distribuidor';
export type ListaPrecio = 'costo' | 'mayoreo' | 'detalle' | 'especial';

export interface Perfil {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
}

export interface Linea {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface Producto {
  id: string;
  codigo_interno: string;
  codigo_barras: string | null;
  nombre: string;
  marca: string;
  linea_id: number;
  presentacion: string | null;
  unidad_medida: string;
  piezas_por_empaque: number;
  stock_minimo: number;
  activo: boolean;
  es_demo: boolean;
}

export interface PrecioVigente {
  producto_id: string;
  lista: ListaPrecio;
  precio: number;
  vigente_desde: string;
}

export interface PrecioHistorial extends PrecioVigente {
  id: number;
  motivo: string | null;
  registrado_por: string | null;
}

export interface Ubicacion {
  id: string;
  nombre: string;
  tipo: 'bodega' | 'preparacion' | 'vendedor';
  vendedor_id: string | null;
  activo: boolean;
}

export interface ExistenciaVista {
  ubicacion_id: string;
  ubicacion: string;
  tipo_ubicacion: Ubicacion['tipo'];
  producto_id: string;
  codigo_interno: string;
  producto: string;
  linea: string;
  cantidad: number;
  stock_minimo: number;
  bajo_minimo: boolean;
}

export interface Movimiento {
  id: number;
  creado_en: string;
  producto_id: string;
  cantidad: number;
  tipo: string;
  origen_id: string | null;
  destino_id: string | null;
  usuario_id: string;
  motivo: string | null;
  referencia_tipo: string;
}

export interface Configuracion {
  razon_social: string;
  nombre_comercial: string;
  rfc: string;
  direccion: string;
  telefono: string;
  leyenda_comprobante: string;
  descuento_max_vendedor_pct: number;
}

export interface ResumenDiario {
  dia: string;
  venta_neta: number;
  venta_ruta: number;
  venta_mayoreo: number;
  venta_mostrador: number;
  venta_credito: number;
  costo_vendido: number;
  margen_bruto: number;
  cobrado: number;
  gastos: number;
  resultado_operativo_estimado: number;
  flujo_efectivo_operativo: number;
}

// ---- Entrega 2: ventas en ruta ----
export type EstadoJornada = 'preparacion' | 'abierta' | 'en_cierre' | 'cerrada' | 'cancelada';
export type EstadoCarga = 'preparando' | 'por_confirmar' | 'recibida' | 'cancelada';
export type MetodoPago = 'efectivo' | 'transferencia' | 'otro';
export type CategoriaGasto = 'combustible' | 'alimentacion_ruta' | 'transporte' | 'mantenimiento' | 'operativo' | 'otro';

export interface Jornada {
  id: string;
  vendedor_id: string;
  ubicacion_id: string;
  fecha: string;
  estado: EstadoJornada;
  abierta_en: string | null;
  cerrada_en: string | null;
  creado_en: string;
}

export interface Carga {
  id: string;
  folio: string | null;
  jornada_id: string;
  tipo: 'inicial' | 'adicional';
  estado: EstadoCarga;
  despachada_en: string | null;
  recibida_en: string | null;
  notas: string | null;
  creado_en: string;
}

export interface CargaDetalle { carga_id: string; producto_id: string; cantidad: number }

export interface Cliente {
  id: string;
  nombre: string;
  tipo: 'detalle' | 'distribuidor' | 'mostrador';
  telefono: string | null;
  direccion: string | null;
  lista_precio: Exclude<ListaPrecio, 'costo'>;
  permite_credito: boolean;
  limite_credito: number;
  dias_credito: number;
  activo: boolean;
  es_demo: boolean;
}

export interface SaldoVenta {
  venta_id: string;
  folio: string;
  cliente_id: string;
  canal: string;
  condicion: 'contado' | 'credito';
  total: number;
  pagado: number;
  saldo: number;
  fecha_vencimiento: string | null;
  vencida: boolean;
}

export interface Venta {
  id: string;
  folio: string | null;
  canal: 'ruta' | 'mayoreo' | 'mostrador';
  cliente_id: string;
  vendedor_id: string;
  jornada_id: string | null;
  condicion: 'contado' | 'credito';
  fecha_vencimiento: string | null;
  subtotal: number;
  descuento: number;
  total: number;
  estado: 'cerrada' | 'cancelada';
  notas: string | null;
  registrada_en: string;
  sincronizada_en: string;
  motivo_cancelacion: string | null;
}

export interface VentaDetalle {
  venta_id: string;
  renglon: number;
  producto_id: string;
  cantidad: number;
  lista_aplicada: ListaPrecio;
  precio_unitario: number;
  descuento: number;
  importe: number;
}

export interface Pago {
  id: string;
  folio: string | null;
  venta_id: string;
  metodo: MetodoPago;
  monto: number;
  referencia: string | null;
  jornada_id: string | null;
  registrado_en: string;
  estado: 'cerrada' | 'cancelada';
}

export interface Gasto {
  id: string;
  folio: string | null;
  fecha: string;
  categoria: CategoriaGasto;
  concepto: string;
  monto: number;
  metodo: MetodoPago;
  jornada_id: string | null;
  estado: 'cerrada' | 'cancelada';
}

export interface CierreRuta {
  id: string;
  folio: string;
  jornada_id: string;
  ventas_total: number;
  ventas_credito: number;
  cobrado_efectivo: number;
  cobrado_transferencia: number;
  gastos_efectivo: number;
  efectivo_esperado: number;
  efectivo_entregado: number;
  diferencia_efectivo: number;
  piezas_diferencia: number;
  revisado_en: string | null;
  observaciones: string | null;
  creado_en: string;
}

export interface CierreDetalle {
  cierre_id: string;
  producto_id: string;
  inicial: number;
  adicional: number;
  vendido: number;
  devuelto: number;
  merma: number;
  final_teorico: number;
  final_contado: number;
  diferencia: number;
}

export const NOMBRE_JORNADA: Record<EstadoJornada, string> = {
  preparacion: 'En preparación',
  abierta: 'Abierta',
  en_cierre: 'Cierre en revisión',
  cerrada: 'Cerrada',
  cancelada: 'Cancelada'
};

export const NOMBRE_CARGA: Record<EstadoCarga, string> = {
  preparando: 'Preparando',
  por_confirmar: 'Por confirmar',
  recibida: 'Recibida',
  cancelada: 'Cancelada'
};

export const NOMBRE_METODO: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  otro: 'Otro'
};

export const NOMBRE_GASTO: Record<CategoriaGasto, string> = {
  combustible: 'Combustible',
  alimentacion_ruta: 'Alimentación en ruta',
  transporte: 'Transporte',
  mantenimiento: 'Mantenimiento',
  operativo: 'Operativo',
  otro: 'Otro'
};

export const NOMBRE_ROL: Record<Rol, string> = {
  admin: 'Administrador',
  vendedor: 'Vendedor de ruta',
  bodega: 'Operador de bodega',
  distribuidor: 'Distribuidor'
};

export const NOMBRE_LISTA: Record<ListaPrecio, string> = {
  costo: 'Costo Ferrero',
  mayoreo: 'Mayoreo',
  detalle: 'Detalle',
  especial: 'Especial'
};

export const NOMBRE_MOVIMIENTO: Record<string, string> = {
  entrada_compra: 'Entrada por compra',
  traspaso_carga: 'Carga a vendedor',
  traspaso_preparacion: 'A preparación',
  salida_venta: 'Venta',
  cancelacion_venta: 'Cancelación de venta',
  devolucion_bodega: 'Devolución a bodega',
  devolucion_cliente: 'Devolución de cliente',
  merma: 'Merma',
  ajuste_entrada: 'Ajuste (+)',
  ajuste_salida: 'Ajuste (−)'
};
