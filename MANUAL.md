# Manual básico de GUVA · Entrega 2

Esta versión cubre catálogo, inventario de bodega, usuarios, clientes y **ventas en ruta** (carga, venta, cobro, gasto y cierre), también sin señal.

## Entrar

1. Abre GUVA (app instalada o dirección web).
2. Escribe tu correo y contraseña. Cada persona usa **su propio** usuario; no compartan cuentas.
3. Si ves "el administrador aún no te asigna un rol", pide al administrador que te dé de alta en **Usuarios**.

## Qué ve cada quien

| | Administrador (PC matriz) | Vendedor (teléfono) | Bodega |
|---|---|---|---|
| Catálogo y precios de venta | Sí, y los edita | Solo consulta | Solo consulta |
| Costo de compra | Sí | No | No |
| Inventario | Todas las ubicaciones | Su inventario y bodega | Todas las ubicaciones |
| Registrar entradas | Sí | No | Sí |
| Abrir jornadas y revisar cierres | Sí | No | No |
| Preparar y despachar cargas | Sí | No | Sí |
| Vender, cobrar, gastos y cierre de ruta | No | Sí (su ruta) | No |
| Ventas | Todas, y las cancela | Las suyas | No |
| Clientes, usuarios y ajustes | Sí | No | No |

## Cargar el catálogo (administrador)

1. **Catálogo → Importar CSV → Descargar plantilla.**
2. Ábrela en Excel y llena una fila por producto con la lista real de Ferrero.
   - Obligatorio: código interno, nombre, marca, línea (Ferrero, Kinder, Vualá o Gomitas).
   - Precios **por pieza**. Si dejas un precio vacío, no se cambia.
3. En Excel: **Archivo → Guardar como → CSV UTF-8**.
4. Súbelo con **Elegir archivo CSV**. GUVA revisa todo antes de guardar y te dice fila por fila qué corregir.
5. Si todo está bien, pulsa **Importar**. Si un solo dato falla, no se guarda nada: corriges y vuelves a subir.

Para un producto suelto: **Catálogo → Nuevo producto**. Para cambiar un precio, toca el producto,
escribe el precio nuevo y el motivo (por ejemplo "Lista Ferrero diciembre"). El precio anterior queda en el historial.

## Registrar mercancía que llega (administrador o bodega)

1. **Entrada.**
2. Busca el producto por nombre o escanea/teclea su código de barras y pulsa Enter.
3. Captura **empaques** y **piezas sueltas**. GUVA calcula el total de piezas con las piezas por empaque del producto.
4. Escribe el número de factura o remisión de Ferrero.
5. **Registrar entrada.** Recibes un folio (EN-000001) y la existencia de bodega sube al instante.

Las entradas no se borran. Si hubo un error, el administrador lo corrige con un ajuste (siguiente entrega) que queda registrado.

## Consultar inventario

**Inventario** muestra las piezas por ubicación: bodega principal y el inventario de cada vendedor.
Marca **Bajo mínimo** para ver lo que hay que pedir. **Movimientos** muestra quién movió qué, cuándo y por qué.

## Clientes (administrador)

**Clientes → Nuevo cliente.** Elige su **lista de precios** (Detalle o Mayoreo) y, si le das crédito,
marca **Permite crédito** con su límite y sus días (máximo 60). Las ventas sin cliente van a "Venta de mostrador".

## Un día de ruta, paso a paso

1. **Administrador → Rutas → Abrir jornada** y elige la ruta del vendedor.
   GUVA anota lo que el vendedor ya traía en su inventario.
2. **Bodega → Rutas →** toca la jornada **→ Nueva carga inicial.** Agrega los productos (empaques y sueltas)
   y pulsa **Guardar y despachar**. La mercancía sale de bodega hacia el inventario del vendedor.
3. **Vendedor → Mi ruta.** Aparece la carga: cuéntala y pulsa **Recibí la carga completa**.
   Si algo no coincide, no confirmes y avisa a bodega. Al confirmar, la jornada queda **abierta**.
4. **Vender.** Elige el cliente (o deja "Venta de mostrador"), busca o escanea cada producto y ajusta
   la cantidad con − y +. Elige **Efectivo** o **Transferencia**; si escribes cuánto te dieron, GUVA calcula el cambio.
   Si el cliente tiene crédito, aparece **Crédito**. Pulsa **Cobrar y registrar**: verás el comprobante
   para **Imprimir** o **Compartir** por WhatsApp.
5. **Cobrar abono:** elige la venta a crédito, escribe el monto y la forma de pago.
6. **Registrar gasto:** gasolina, comida en ruta, etc. Los gastos en efectivo se restan del efectivo que entregas.
7. ¿Se acabó un producto a media ruta? Bodega prepara una **carga adicional** y el vendedor la confirma igual que la primera.
8. **Cerrar ruta** (requiere señal): cuenta lo que te queda y escribe las piezas de cada producto, luego
   el efectivo que entregas. GUVA te dice si cuadra el efectivo y cuántas piezas tienen diferencia.
9. **Administrador → Rutas →** jornada **→ Aprobar y cerrar jornada.** Revisa el efectivo y el conteo producto por producto.
   Las diferencias de mercancía quedan como ajustes registrados.

## Vender sin señal

- Ventas, cobros y gastos se guardan en el teléfono y **se envían solos** cuando vuelve la señal.
  Arriba verás cuántos hay "por enviar". En **Mi ruta → Envíos al servidor** puedes pulsar **Enviar ahora**.
- Para vender sin señal, el teléfono necesita haber abierto GUVA **con señal** al menos una vez en el día
  (descarga catálogo, precios, tu inventario y clientes). **Mi ruta → Actualizar** lo hace al momento.
- Mientras no se envía, la venta no tiene folio: el comprobante dice "Pendiente de folio".
- El precio final lo confirma el servidor. Si el administrador cambió un precio antes de que se enviara la venta,
  el comprobante te avisa la diferencia.
- Si el servidor **rechaza** un registro (por ejemplo, un producto sin precio), aparece en rojo en **Mi ruta** con el motivo.
  Pide al administrador que lo corrija y pulsa **Reintentar**, o **Descartar** si no procede.
- No cierres sesión con registros por enviar si no es necesario. Si lo haces, se quedan en el teléfono y se envían
  cuando vuelvas a entrar **con tu mismo usuario**.
- No borres los datos del navegador ni desinstales la app con registros por enviar: se perderían.

## Ventas y cancelaciones

**Ventas** muestra las ventas del día (el vendedor ve solo las suyas). Toca una para ver productos y cobros.
El administrador puede **cancelarla con un motivo**: la mercancía regresa al inventario y sus cobros se cancelan.
Una venta de una jornada ya cerrada no se cancela; se corrige con una devolución de cliente.

## Dar de alta a una persona (administrador)

1. En Supabase: *Authentication → Users → Add user* con su correo y una contraseña.
2. En GUVA: **Usuarios → Asignar rol**, escribe su nombre y elige el rol.
   Un vendedor recibe automáticamente su inventario de ruta.
3. Para dar de baja: toca a la persona y desmarca **Usuario activo**. Su historial se conserva.

## Ajustes (administrador)

Captura razón social, RFC, dirección y teléfono: aparecerán en los comprobantes.
El **descuento máximo del vendedor** empieza en 0 %: los vendedores no pueden descontar hasta que lo cambies.

Los comprobantes de GUVA son internos. **No son facturas fiscales (CFDI).**
