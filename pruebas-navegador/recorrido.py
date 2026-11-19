# Recorrido de prueba en navegador contra la base guva_e2e. Datos de PRUEBA.
import re, sys
from playwright.sync_api import sync_playwright, expect
BASE = 'http://localhost:5173'
CAP = '/home/claude/e2e/capturas/'
errores_consola = []

def entrar(page, correo):
    page.goto(BASE)
    page.get_by_label('Correo').fill(correo)
    page.get_by_label('Contraseña').fill('prueba123')
    page.get_by_role('button', name='Entrar').click()

def paso(msg): print('OK:', msg, flush=True)

with sync_playwright() as p:
    nav = p.chromium.launch(channel='chrome', args=['--no-sandbox'])
    # ---------- Administrador en la PC matriz ----------
    ctx = nav.new_context(viewport={'width': 1366, 'height': 860}, locale='es-MX', timezone_id='America/Mexico_City')
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and errores_consola.append(m.text))
    page.goto(BASE); page.get_by_label('Correo').fill('admin@prueba.local'); page.get_by_label('Contraseña').fill('mala')
    page.get_by_role('button', name='Entrar').click()
    expect(page.get_by_text('Correo o contraseña incorrectos.')).to_be_visible(); paso('contraseña incorrecta rechazada')
    page.screenshot(path=CAP + '01_ingreso.png')
    entrar(page, 'admin@prueba.local')
    expect(page.get_by_role('heading', name='Resumen de hoy')).to_be_visible()
    expect(page.get_by_text('Faltan datos de GUVA')).to_be_visible(); paso('admin entra y ve aviso POR CONFIGURAR')

    # Importar catálogo
    page.get_by_role('link', name='Catálogo').click()
    expect(page.get_by_text('El catálogo está vacío')).to_be_visible()
    page.get_by_role('link', name='Importar CSV').click()
    page.locator('input[type=file]').set_input_files('/home/claude/e2e/catalogo_prueba.csv')
    expect(page.get_by_text('3 productos listos')).to_be_visible()
    page.screenshot(path=CAP + '02_importar_vista_previa.png', full_page=True)
    page.get_by_role('button', name='Importar 3 productos').click()
    expect(page.get_by_text('3 productos nuevos')).to_be_visible()
    expect(page.get_by_text('9 precios registrados')).to_be_visible(); paso('CSV con ; $ y comas decimales importado: 3 productos, 9 precios')

    page.get_by_role('link', name='Volver al catálogo').click()
    fila = page.get_by_role('row', name=re.compile('Producto PRUEBA uno'))
    expect(fila).to_contain_text('$10.50'); expect(fila).to_contain_text('$15.00'); paso('catálogo muestra costo y precios')

    # Editar precio con motivo -> historial
    fila.click()
    page.get_by_label('Detalle', exact=True).fill('16')
    page.get_by_label('Motivo del cambio de precio').fill('Ajuste PRUEBA')
    page.get_by_role('button', name='Guardar', exact=True).click()
    expect(page.get_by_role('status').filter(has_text='Guardado.')).to_be_visible()
    expect(page.get_by_text('Ajuste PRUEBA')).to_be_visible(); paso('cambio de precio queda en historial')
    page.screenshot(path=CAP + '03_ficha_producto.png')
    page.get_by_label('Cerrar').click()

    # Nuevo producto con código duplicado -> error claro
    page.get_by_role('button', name='Nuevo producto').click()
    page.get_by_label('Código interno').fill('PRB-001'); page.get_by_label('Nombre comercial').fill('Duplicado')
    page.get_by_label('Marca').fill('X'); page.get_by_role('button', name='Guardar', exact=True).click()
    expect(page.get_by_text('Ya existe un producto con ese código')).to_be_visible(); paso('código duplicado rechazado con mensaje claro')
    page.get_by_label('Cerrar').click()

    # Entrada de mercancía: escaneo por código de barras + empaques
    page.get_by_role('link', name='Entrada').click()
    buscador = page.get_by_placeholder('Buscar producto o escanear código de barras')
    buscador.fill('7500000000011'); buscador.press('Enter')
    page.get_by_label('Empaques').fill('5'); page.get_by_label('Piezas sueltas').fill('3')
    expect(page.get_by_text('63 pzas')).to_be_visible()
    buscador.fill('PRUEBA dos'); page.get_by_role('button', name=re.compile('Producto PRUEBA dos')).click()
    page.get_by_label('Empaques').nth(1).fill('2')
    page.get_by_role('button', name='Registrar entrada').click()
    expect(page.get_by_text('Captura la factura o remisión')).to_be_visible()
    page.get_by_label('Factura o remisión de Ferrero').fill('REM-PRUEBA-1')
    page.screenshot(path=CAP + '04_entrada.png', full_page=True)
    page.get_by_role('button', name='Registrar entrada').click()
    expect(page.get_by_text(re.compile('folio EN-000001'))).to_be_visible(); paso('entrada EN-000001: 63 + 16 piezas')

    page.get_by_role('link', name='Ver inventario').click()
    expect(page.get_by_role('row', name=re.compile('Producto PRUEBA uno'))).to_contain_text('63')
    expect(page.get_by_role('row', name=re.compile('Producto PRUEBA dos'))).to_contain_text('16')
    paso('existencias de bodega correctas')
    page.get_by_role('link', name='Movimientos').click()
    expect(page.get_by_role('row', name=re.compile('Entrada por compra')).first).to_contain_text('REM-PRUEBA-1'); paso('movimiento trazable con usuario y remisión')
    page.screenshot(path=CAP + '05_movimientos.png')

    # Usuarios: asignar rol a papá (vendedor)
    page.get_by_role('link', name='Usuarios').click()
    page.get_by_role('listitem').filter(has_text='papa@prueba.local').get_by_role('button', name='Asignar rol').click()
    page.get_by_label('Nombre').fill('Papá PRUEBA')
    page.get_by_role('button', name='Guardar', exact=True).click()
    expect(page.get_by_role('row', name=re.compile('Papá PRUEBA'))).to_contain_text('Vendedor de ruta'); paso('vendedor dado de alta desde la app')
    page.screenshot(path=CAP + '06_usuarios.png')

    # Ajustes
    page.get_by_role('link', name='Ajustes').click()
    page.get_by_label('Razón social').fill('RAZON SOCIAL PRUEBA'); page.get_by_label('Descuento máximo', exact=False).fill('150')
    page.get_by_role('button', name='Guardar ajustes').click()
    assert page.get_by_label('Descuento máximo', exact=False).evaluate('e => !e.checkValidity()'), 'debía bloquear 150 %'
    expect(page.get_by_text('Ajustes guardados.')).to_have_count(0)
    page.get_by_label('Descuento máximo', exact=False).fill('5'); page.get_by_role('button', name='Guardar ajustes').click()
    expect(page.get_by_text('Ajustes guardados.')).to_be_visible(); paso('ajustes validados y guardados')
    ctx.close()

    # ---------- Vendedor en su teléfono ----------
    ctx = nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='es-MX')
    page = ctx.new_page(); page.on('console', lambda m: m.type == 'error' and errores_consola.append(m.text))
    entrar(page, 'papa@prueba.local')
    expect(page.get_by_role('heading', name='Hola, Papá PRUEBA')).to_be_visible()
    page.screenshot(path=CAP + '07_vendedor_inicio_movil.png')
    page.get_by_role('link', name='Catálogo').click()
    item = page.get_by_role('listitem').filter(has_text='Producto PRUEBA uno')
    expect(item).to_contain_text('$16.00')
    expect(item).not_to_contain_text('Costo'); expect(item).not_to_contain_text('$10.50'); paso('vendedor ve precios, no ve costo')
    expect(page.get_by_role('button', name='Nuevo producto')).to_have_count(0)
    expect(page.get_by_role('link', name='Usuarios')).to_have_count(0); paso('vendedor sin menús de administración')
    page.screenshot(path=CAP + '08_vendedor_catalogo_movil.png')
    page.goto(BASE + '/usuarios')
    expect(page.get_by_text('No tienes acceso a esta sección.')).to_be_visible(); paso('ruta de admin bloqueada al vendedor')
    ctx.close()

    # ---------- Bodega ----------
    ctx = nav.new_context(viewport={'width': 1366, 'height': 860}, locale='es-MX'); page = ctx.new_page()
    entrar(page, 'bodega@prueba.local')
    page.get_by_role('link', name='Catálogo').click()
    expect(page.get_by_role('row', name=re.compile('Producto PRUEBA uno'))).not_to_contain_text('$10.50'); paso('bodega no ve costos')
    expect(page.get_by_role('heading', name='Catálogo')).to_be_visible()
    ctx.close()

    # ---------- Usuario sin rol ----------
    ctx = nav.new_context(); page = ctx.new_page(); entrar(page, 'hijo1@prueba.local')
    expect(page.get_by_text('aún no te asigna un rol')).to_be_visible(); paso('cuenta sin rol no entra al sistema'); ctx.close()
    nav.close()

reales = [e for e in errores_consola if 'favicon' not in e]
print('Errores de consola:', reales if reales else 'ninguno')
print('=== RECORRIDO COMPLETO ===')
