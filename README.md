# GUVA · Sistema de administración, distribución y control financiero

Avance: **Base de datos del MVP + Entregas 1 y 2 del frontend**.
- Entrega 1: inicio de sesión, roles, catálogo, importación CSV, inventario de bodega, entradas, usuarios y ajustes.
- Entrega 2: ventas en ruta (jornada, carga, confirmación, punto de venta, comprobante, cobro de abonos,
  gastos, cierre con conteo físico y revisión), clientes, consulta y cancelación de ventas, y **cola offline**.

Siguiente: mayoreo y mostrador desde la PC, cuentas por cobrar, devoluciones/mermas y dashboard.

Equipos: PC del negocio = matriz (administración y bodega) · 3 teléfonos de ruta, uno por vendedor.

## Contenido

```
guva/
├── README.md
├── MANUAL.md                                 # manual básico de usuario
├── app/                                      # PWA: React 19 + TypeScript + Vite + Tailwind
│   ├── .env.example
│   └── src/  (auth, app, ui, lib, modulos/{inicio,catalogo,inventario,usuarios,configuracion,
│                                             ruta,rutas,ventas,clientes})
├── pruebas-navegador/                        # recorrido automático opcional (ver LEEME.md)
└── supabase/
    ├── migrations/
    │   ├── 20261112000001_esquema.sql        # tablas, tipos, restricciones
    │   ├── 20261112000002_funciones.sql      # reglas de negocio (RPC), vistas, triggers
    │   ├── 20261112000003_seguridad_rls.sql  # permisos, RLS, privilegios por columna
    │   ├── 20261117000004_catalogo_usuarios.sql # importación de catálogo y alta de usuarios
    │   ├── 20261117000005_correcciones.sql   # correcciones de la revisión de la Entrega 1
    │   └── 20261118000006_ventas_offline.sql # venta capturada sin señal, liquidada por el servidor
    └── tests/
        ├── 00_stub_supabase.sql              # solo pruebas locales (emula auth de Supabase)
        ├── 01_prueba_flujo_mvp.sql           # flujo completo de ruta, mayoreo y cierre
        ├── 02_prueba_catalogo_usuarios.sql   # importación de catálogo y alta de usuarios
        ├── 03_prueba_correcciones.sql        # cancelaciones, cierre, perfiles, productos inactivos
        ├── 04_prueba_ventas_offline.sql      # venta offline, cambio de precio, reenvío, gasto y cierre
        └── correr_pruebas.sh                 # recrea la base y corre todas las pruebas
```

## 1. Crear el proyecto en Supabase

1. Entra a https://supabase.com y crea un proyecto (plan gratuito es suficiente para iniciar).
   Región sugerida: la más cercana a México que ofrezca el panel.
2. Guarda la contraseña de la base de datos en un gestor de contraseñas. **No la pongas en el código.**
3. En *Project Settings → API* copia `Project URL` y la clave `anon public`. Van en `.env.local` del frontend.
   La clave `service_role` **nunca** va en el frontend.

## 2. Aplicar las migraciones

Opción A · Supabase CLI (recomendada, desde Visual Studio Code):

```bash
npm install -g supabase          # o: npx supabase ...
supabase login
supabase link --project-ref <REF_DEL_PROYECTO>
supabase db push                 # aplica supabase/migrations en orden
```

Opción B · Panel web: *SQL Editor* → pega y ejecuta los seis archivos de `migrations/` **en orden**.
Si ya habías aplicado los primeros cinco (Entrega 1), ejecuta solo `20261118000006_ventas_offline.sql`.

No ejecutes `supabase/tests/00_stub_supabase.sql` en el proyecto real: solo emula Supabase para pruebas locales.

## 3. Usuarios

Cada persona tiene su propio usuario: así cada venta, carga y cierre queda a su nombre.

1. *Authentication → Users → Add user*: crea la cuenta del administrador (correo y contraseña).
2. Copia su `UUID` y ejecuta **una sola vez** en *SQL Editor*:

```sql
insert into perfiles (id, nombre, rol) values ('<UUID>', '<Nombre>', 'admin');
```

3. Para los demás (tu papá, los dos hijos, bodega): crea su cuenta en *Add user* y después,
   ya dentro de GUVA como administrador, ve a **Usuarios → Asignar rol**.
   Al elegir *Vendedor de ruta* se crea automáticamente su inventario de ruta.

## 4. Configurar datos del negocio (POR CONFIGURAR)

```sql
update configuracion set
  razon_social = '...', rfc = '...', direccion = '...', telefono = '...',
  descuento_max_vendedor_pct = 0;   -- % máximo que un vendedor puede descontar
```

Precios y costos se registran **solo** con la función `establecer_precio` (queda historial):

```sql
select establecer_precio('<producto_id>', 'costo',   <costo Ferrero>, 'Lista Ferrero <fecha>');
select establecer_precio('<producto_id>', 'detalle', <precio>,        'Alta');
select establecer_precio('<producto_id>', 'mayoreo', <precio>,        'Alta');
```

## 5. Ejecutar la app en Visual Studio Code

```bash
cd app
cp .env.example .env.local      # y pon tu Project URL y anon key
npm install
npm run dev                     # abre http://localhost:5173
npm test                        # pruebas unitarias
npm run build                   # versión de producción en app/dist
```

Publicar gratis: sube el repositorio a GitHub y conéctalo a Vercel, Netlify o Cloudflare Pages
(carpeta raíz `app`, comando `npm run build`, salida `dist`, variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`).
En *Supabase → Authentication → URL Configuration* agrega la dirección pública de la app.

Instalar en los teléfonos Android: abre la dirección en Chrome → menú ⋮ → **Instalar app**.
En la PC: Chrome o Edge → icono de instalar en la barra de direcciones.

### Cómo funciona sin señal (Entrega 2)

- `app/src/lib/datosRuta.ts` guarda en el teléfono la jornada, catálogo, precios de venta (sin costos),
  existencia del vendedor, clientes y saldos. Se refresca al abrir, al volver la señal y tras cada envío.
- `app/src/lib/cola.ts` guarda ventas, cobros y gastos en `localStorage` (por usuario) y los envía en orden
  cada 30 s, al volver la señal y al regresar a la app. Errores de red se reintentan solos; un rechazo
  del servidor queda marcado para que el vendedor lo reintente o descarte.
- El perfil se guarda en el teléfono para que la app abra sin señal con la sesión ya iniciada.
- Abrir jornada, confirmar carga y cerrar ruta requieren señal. El cierre exige que no haya pendientes.
- La venta a crédito valida el límite en el teléfono solo con las ventas del propio vendedor;
  el servidor valida con todas al sincronizar.

## 6. Probar la base localmente (opcional)

Requiere PostgreSQL 15+ instalado.

```bash
bash supabase/tests/correr_pruebas.sh
# Debe terminar con: === PRUEBAS DE VENTAS OFFLINE PASARON ===
```

Los datos de la prueba están marcados `es_demo = true` y nombres con "PRUEBA". Nunca se cargan en producción.

## Reglas que la base de datos garantiza

- Existencias nunca negativas; dos terminales no pueden vender la misma pieza (bloqueo de fila + `CHECK`).
- Una venta reenviada por mala señal no descuenta dos veces (id generado en el dispositivo).
- Una venta de contado capturada sin señal se liquida con el precio vigente del servidor al sincronizar.
- El vendedor no ve costos ni puede fijar precios; el servidor decide precio y costo.
- Ventas, cobros, gastos, movimientos y cierres no se borran: se cancelan con motivo y movimiento compensatorio.
- Lo que ya forma parte de un cierre de ruta no se cancela (se corrige con devolución de cliente).
- Los perfiles y roles solo se cambian desde **Usuarios** (función `alta_perfil`).
- Toda alta o cambio queda en `auditoria`.
- Los comprobantes son internos: **no son CFDI**.
