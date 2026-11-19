-- =====================================================================
-- GUVA · Migración 0001 · Esquema base (Etapa 1 · MVP operativo)
-- Tablas, tipos y restricciones. Sin datos ficticios.
-- =====================================================================

create extension if not exists pgcrypto;

-- Fecha operativa de GUVA (hora del centro de México), independiente del huso del servidor
create or replace function hoy() returns date
language sql stable set search_path = public, pg_temp as
$$ select (now() at time zone 'America/Mexico_City')::date $$;

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
create type rol_usuario      as enum ('admin', 'vendedor', 'bodega', 'distribuidor');
create type tipo_ubicacion   as enum ('bodega', 'preparacion', 'vendedor');
create type lista_precio     as enum ('costo', 'mayoreo', 'detalle', 'especial');
create type tipo_cliente     as enum ('detalle', 'distribuidor', 'mostrador');
create type canal_venta      as enum ('ruta', 'mayoreo', 'mostrador');
create type condicion_pago   as enum ('contado', 'credito');
create type metodo_pago      as enum ('efectivo', 'transferencia', 'otro');
create type estado_documento as enum ('cerrada', 'cancelada');
create type estado_jornada   as enum ('preparacion', 'abierta', 'en_cierre', 'cerrada', 'cancelada');
create type estado_carga     as enum ('preparando', 'por_confirmar', 'recibida', 'cancelada');
create type tipo_carga       as enum ('inicial', 'adicional');
create type categoria_gasto  as enum ('combustible', 'alimentacion_ruta', 'transporte',
                                      'mantenimiento', 'operativo', 'otro');
create type tipo_movimiento  as enum (
  'entrada_compra',      -- (externo) -> bodega
  'traspaso_carga',      -- bodega/preparación -> vendedor
  'traspaso_preparacion',-- bodega -> preparación
  'salida_venta',        -- ubicación -> (cliente)
  'cancelacion_venta',   -- (cliente) -> ubicación   [compensatorio]
  'devolucion_bodega',   -- vendedor -> bodega
  'devolucion_cliente',  -- (cliente) -> ubicación
  'merma',               -- ubicación -> (baja)
  'ajuste_entrada',      -- (ajuste) -> ubicación
  'ajuste_salida'        -- ubicación -> (ajuste)
);

-- ---------------------------------------------------------------------
-- Configuración de la empresa (fila única). Valores reales: POR CONFIGURAR
-- ---------------------------------------------------------------------
create table configuracion (
  id                         boolean primary key default true check (id),
  razon_social               text    not null default 'POR CONFIGURAR',
  nombre_comercial           text    not null default 'GUVA',
  rfc                        text    not null default 'POR CONFIGURAR',
  direccion                  text    not null default 'POR CONFIGURAR',
  telefono                   text    not null default 'POR CONFIGURAR',
  leyenda_comprobante        text    not null default
    'Comprobante interno de operación. No es un CFDI ni tiene validez fiscal.',
  descuento_max_vendedor_pct numeric(5,2) not null default 0
    check (descuento_max_vendedor_pct between 0 and 100),
  actualizado_en             timestamptz not null default now()
);
insert into configuracion default values;

-- ---------------------------------------------------------------------
-- Usuarios (extiende auth.users de Supabase)
-- ---------------------------------------------------------------------
create table perfiles (
  id         uuid primary key references auth.users(id) on delete restrict,
  nombre     text not null,
  rol        rol_usuario not null,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Ubicaciones de inventario: bodega, preparación y una por vendedor
-- ---------------------------------------------------------------------
create table ubicaciones (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  tipo        tipo_ubicacion not null,
  vendedor_id uuid unique references perfiles(id),
  activo      boolean not null default true,
  check ((tipo = 'vendedor') = (vendedor_id is not null))
);
insert into ubicaciones (nombre, tipo) values
  ('Bodega principal', 'bodega'),
  ('Preparación de pedidos', 'preparacion');

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------
create table lineas (
  id     smallserial primary key,
  nombre text not null unique,
  activo boolean not null default true
);
-- Las cuatro líneas de la Etapa 1 son un dato del negocio, no ficticio.
insert into lineas (nombre) values ('Ferrero'), ('Kinder'), ('Vualá'), ('Gomitas');

create table productos (
  id                 uuid primary key default gen_random_uuid(),
  codigo_interno     text not null unique,
  codigo_barras      text unique,
  nombre             text not null,
  marca              text not null,
  linea_id           smallint not null references lineas(id),
  presentacion       text,
  unidad_medida      text not null default 'pieza',
  piezas_por_empaque integer not null default 1 check (piezas_por_empaque > 0),
  stock_minimo       integer not null default 0 check (stock_minimo >= 0),
  activo             boolean not null default true,
  es_demo            boolean not null default false,
  creado_en          timestamptz not null default now()
);
create index on productos (linea_id);

-- Historial de costos y precios. El vigente es el más reciente por lista.
create table precios_historial (
  id             bigserial primary key,
  producto_id    uuid not null references productos(id),
  lista          lista_precio not null,
  precio         numeric(12,2) not null check (precio >= 0),
  vigente_desde  timestamptz not null default now(),
  registrado_por uuid references perfiles(id),
  motivo         text
);
create index on precios_historial (producto_id, lista, vigente_desde desc);

-- ---------------------------------------------------------------------
-- Clientes (detalle, distribuidores y "venta de mostrador")
-- ---------------------------------------------------------------------
create table clientes (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  tipo                tipo_cliente not null default 'detalle',
  telefono            text,
  direccion           text,
  lista_precio        lista_precio not null default 'detalle'
                      check (lista_precio <> 'costo'),
  permite_credito     boolean not null default false,
  limite_credito      numeric(12,2) not null default 0 check (limite_credito >= 0),
  dias_credito        smallint not null default 0 check (dias_credito between 0 and 60),
  activo              boolean not null default true,
  es_demo             boolean not null default false,
  creado_en           timestamptz not null default now()
);
-- Cliente genérico para ventas sin identificar
insert into clientes (nombre, tipo) values ('Venta de mostrador', 'mostrador');

-- ---------------------------------------------------------------------
-- Folios consecutivos por serie
-- ---------------------------------------------------------------------
create table folios (
  serie  text primary key,
  ultimo integer not null default 0
);
insert into folios (serie) values
  ('VR'),  -- venta en ruta
  ('VM'),  -- venta de mayoreo
  ('VT'),  -- venta de mostrador
  ('CO'),  -- cobro / abono
  ('GA'),  -- gasto
  ('CA'),  -- carga a vendedor
  ('EN'),  -- entrada de mercancía
  ('DE'),  -- devolución / merma
  ('AJ'),  -- ajuste de inventario
  ('CR');  -- cierre de ruta

-- ---------------------------------------------------------------------
-- Inventario basado en movimientos
-- ---------------------------------------------------------------------
create table movimientos_inventario (
  id               bigserial primary key,
  creado_en        timestamptz not null default now(),
  producto_id      uuid not null references productos(id),
  cantidad         integer not null check (cantidad > 0),
  tipo             tipo_movimiento not null,
  origen_id        uuid references ubicaciones(id),
  destino_id       uuid references ubicaciones(id),
  usuario_id       uuid not null references perfiles(id),
  motivo           text,
  referencia_tipo  text not null,   -- 'venta', 'carga', 'entrada', 'ajuste', ...
  referencia_id    uuid not null,
  costo_unitario   numeric(12,2),
  jornada_id       uuid,
  check (origen_id is not null or destino_id is not null),
  check (origen_id is distinct from destino_id)
);
create index on movimientos_inventario (producto_id, creado_en);
create index on movimientos_inventario (referencia_tipo, referencia_id);
create index on movimientos_inventario (jornada_id);

-- Saldo materializado por ubicación. Solo lo modifica el trigger de movimientos.
-- CHECK >= 0: dos dispositivos no pueden vender la misma pieza.
create table existencias (
  ubicacion_id uuid not null references ubicaciones(id),
  producto_id  uuid not null references productos(id),
  cantidad     integer not null default 0 check (cantidad >= 0),
  actualizado_en timestamptz not null default now(),
  primary key (ubicacion_id, producto_id)
);

-- ---------------------------------------------------------------------
-- Ventas en ruta: jornadas y cargas
-- ---------------------------------------------------------------------
create table jornadas_ruta (
  id            uuid primary key default gen_random_uuid(),
  vendedor_id   uuid not null references perfiles(id),
  ubicacion_id  uuid not null references ubicaciones(id),
  fecha         date not null default hoy(),
  estado        estado_jornada not null default 'preparacion',
  abierta_en    timestamptz,
  cerrada_en    timestamptz,
  creada_por    uuid not null references perfiles(id),
  creado_en     timestamptz not null default now()
);
-- Un vendedor no puede tener dos jornadas activas
create unique index jornada_activa_unica on jornadas_ruta (vendedor_id)
  where estado in ('preparacion', 'abierta', 'en_cierre');

alter table movimientos_inventario
  add constraint movimientos_jornada_fk foreign key (jornada_id) references jornadas_ruta(id);

-- Existencia del vendedor al crear la jornada (mercancía que ya traía)
create table jornada_saldo_inicial (
  jornada_id  uuid not null references jornadas_ruta(id),
  producto_id uuid not null references productos(id),
  cantidad    integer not null check (cantidad >= 0),
  primary key (jornada_id, producto_id)
);

create table cargas (
  id            uuid primary key default gen_random_uuid(),
  folio         text unique,
  jornada_id    uuid not null references jornadas_ruta(id),
  tipo          tipo_carga not null default 'inicial',
  estado        estado_carga not null default 'preparando',
  preparada_por uuid not null references perfiles(id),
  despachada_en timestamptz,
  recibida_en   timestamptz,
  recibida_por  uuid references perfiles(id),
  notas         text,
  creado_en     timestamptz not null default now()
);

create table carga_detalle (
  carga_id    uuid not null references cargas(id),
  producto_id uuid not null references productos(id),
  cantidad    integer not null check (cantidad > 0),
  primary key (carga_id, producto_id)
);

-- ---------------------------------------------------------------------
-- Ventas (ruta, mayoreo, mostrador)
-- id lo genera el dispositivo (UUID) => la sincronización es idempotente
-- ---------------------------------------------------------------------
create table ventas (
  id                uuid primary key,
  folio             text unique,
  canal             canal_venta not null,
  cliente_id        uuid not null references clientes(id),
  vendedor_id       uuid not null references perfiles(id),
  jornada_id        uuid references jornadas_ruta(id),
  ubicacion_id      uuid not null references ubicaciones(id),
  condicion         condicion_pago not null default 'contado',
  fecha_vencimiento date,
  subtotal          numeric(12,2) not null check (subtotal >= 0),
  descuento         numeric(12,2) not null default 0 check (descuento >= 0),
  total             numeric(12,2) not null check (total >= 0),
  costo_total       numeric(12,2) not null check (costo_total >= 0),
  estado            estado_documento not null default 'cerrada',
  notas             text,
  registrada_en     timestamptz not null,          -- hora del dispositivo
  sincronizada_en   timestamptz not null default now(),
  dispositivo_id    text,
  cancelada_en      timestamptz,
  cancelada_por     uuid references perfiles(id),
  motivo_cancelacion text,
  check (total = subtotal - descuento),
  check ((canal = 'ruta') = (jornada_id is not null)),
  check ((condicion = 'credito') = (fecha_vencimiento is not null))
);
create index on ventas (registrada_en);
create index on ventas (cliente_id);
create index on ventas (jornada_id);

create table venta_detalle (
  venta_id        uuid not null references ventas(id),
  renglon         smallint not null,
  producto_id     uuid not null references productos(id),
  cantidad        integer not null check (cantidad > 0),
  lista_aplicada  lista_precio not null check (lista_aplicada <> 'costo'),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  descuento       numeric(12,2) not null default 0 check (descuento >= 0),
  importe         numeric(12,2) not null,
  costo_unitario  numeric(12,2) not null check (costo_unitario >= 0),
  primary key (venta_id, renglon),
  check (importe = cantidad * precio_unitario - descuento)
);

-- ---------------------------------------------------------------------
-- Cobros: cada cobro se aplica a una venta (contado o abono a crédito)
-- ---------------------------------------------------------------------
create table pagos (
  id            uuid primary key,             -- generado en el dispositivo
  folio         text unique,
  venta_id      uuid not null references ventas(id),
  cliente_id    uuid not null references clientes(id),
  metodo        metodo_pago not null,
  monto         numeric(12,2) not null check (monto > 0),
  referencia    text,
  jornada_id    uuid references jornadas_ruta(id),
  recibido_por  uuid not null references perfiles(id),
  registrado_en timestamptz not null,
  estado        estado_documento not null default 'cerrada',
  cancelado_en  timestamptz,
  cancelado_por uuid references perfiles(id),
  motivo_cancelacion text
);
create index on pagos (venta_id);
create index on pagos (jornada_id);

-- ---------------------------------------------------------------------
-- Gastos
-- ---------------------------------------------------------------------
create table gastos (
  id               uuid primary key,          -- generado en el dispositivo
  folio            text unique,
  fecha            date not null default hoy(),
  categoria        categoria_gasto not null,
  concepto         text not null,
  monto            numeric(12,2) not null check (monto > 0),
  metodo           metodo_pago not null,
  jornada_id       uuid references jornadas_ruta(id),
  usuario_id       uuid not null references perfiles(id),
  comprobante_path text,                      -- Supabase Storage (opcional)
  registrado_en    timestamptz not null,
  estado           estado_documento not null default 'cerrada',
  cancelado_en     timestamptz,
  cancelado_por    uuid references perfiles(id),
  motivo_cancelacion text
);
create index on gastos (fecha);

-- ---------------------------------------------------------------------
-- Entradas de mercancía (compras a Ferrero) y ajustes: encabezados
-- ---------------------------------------------------------------------
create table entradas (
  id            uuid primary key default gen_random_uuid(),
  folio         text unique,
  referencia_proveedor text,                  -- factura / remisión Ferrero
  registrada_por uuid not null references perfiles(id),
  notas         text,
  creado_en     timestamptz not null default now()
);

create table ajustes (
  id            uuid primary key default gen_random_uuid(),
  folio         text unique,
  tipo          tipo_movimiento not null
                check (tipo in ('ajuste_entrada','ajuste_salida','merma','devolucion_bodega','devolucion_cliente')),
  ubicacion_id  uuid not null references ubicaciones(id),
  motivo        text not null,
  autorizado_por uuid not null references perfiles(id),
  jornada_id    uuid references jornadas_ruta(id),
  creado_en     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Cierre de ruta
-- ---------------------------------------------------------------------
create table cierres_ruta (
  id                     uuid primary key default gen_random_uuid(),
  folio                  text unique,
  jornada_id             uuid not null unique references jornadas_ruta(id),
  ventas_total           numeric(12,2) not null,
  ventas_credito         numeric(12,2) not null,
  cobrado_efectivo       numeric(12,2) not null,
  cobrado_transferencia  numeric(12,2) not null,
  gastos_efectivo        numeric(12,2) not null,
  efectivo_esperado      numeric(12,2) not null,
  efectivo_entregado     numeric(12,2) not null,
  diferencia_efectivo    numeric(12,2) not null,
  piezas_diferencia      integer not null,
  cerrado_por            uuid not null references perfiles(id),
  revisado_por           uuid references perfiles(id),
  revisado_en            timestamptz,
  observaciones          text,
  creado_en              timestamptz not null default now()
);

create table cierre_detalle (
  cierre_id      uuid not null references cierres_ruta(id),
  producto_id    uuid not null references productos(id),
  inicial        integer not null,
  adicional      integer not null,
  vendido        integer not null,
  devuelto       integer not null,
  merma          integer not null,
  final_teorico  integer not null,
  final_contado  integer not null,
  diferencia     integer not null,
  primary key (cierre_id, producto_id),
  check (final_teorico = inicial + adicional - vendido - devuelto - merma),
  check (diferencia = final_contado - final_teorico)
);

-- ---------------------------------------------------------------------
-- Auditoría
-- ---------------------------------------------------------------------
create table auditoria (
  id          bigserial primary key,
  creado_en   timestamptz not null default now(),
  usuario_id  uuid,
  tabla       text not null,
  operacion   text not null,
  registro_id text,
  antes       jsonb,
  despues     jsonb
);
create index on auditoria (tabla, registro_id);
