import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { mensajeError } from '../../lib/errores';
import { useConsulta } from '../../lib/useConsulta';
import type { Configuracion as Config } from '../../lib/tipos';
import { Aviso, Boton, Campo, Cargando, Encabezado, Entrada, Tarjeta } from '../../ui/ui';

export function Configuracion() {
  const { datos, cargando, error: errCarga } = useConsulta(() => supabase.from('configuracion').select('*').single(), []);
  const [c, setC] = useState<Config | null>(null);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (datos) setC(datos as Config); }, [datos]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!c) return;
    setError(''); setOk(false);
    const pct = Number(c.descuento_max_vendedor_pct);
    if (!(pct >= 0 && pct <= 100)) return setError('El descuento máximo debe estar entre 0 y 100.');
    setGuardando(true);
    const { error } = await supabase.from('configuracion').update({
      razon_social: c.razon_social.trim(), nombre_comercial: c.nombre_comercial.trim(), rfc: c.rfc.trim().toUpperCase(),
      direccion: c.direccion.trim(), telefono: c.telefono.trim(), leyenda_comprobante: c.leyenda_comprobante.trim(),
      descuento_max_vendedor_pct: pct, actualizado_en: new Date().toISOString()
    }).eq('id', true);
    setGuardando(false);
    if (error) setError(mensajeError(error)); else setOk(true);
  }

  if (cargando || !c) return errCarga ? <Aviso tipo="error">{errCarga}</Aviso> : <Cargando />;
  const campo = (k: keyof Config, etiqueta: string, ayuda?: string) => (
    <Campo etiqueta={etiqueta} ayuda={ayuda}>
      <Entrada value={String(c[k])} onChange={e => setC({ ...c, [k]: e.target.value })} />
    </Campo>
  );

  return (
    <>
      <Encabezado titulo="Ajustes de GUVA" detalle="Datos que aparecen en los comprobantes y reglas de venta" />
      <Tarjeta className="max-w-2xl">
        <form onSubmit={guardar} className="space-y-3">
          {campo('nombre_comercial', 'Nombre comercial')}
          {campo('razon_social', 'Razón social')}
          {campo('rfc', 'RFC')}
          {campo('direccion', 'Dirección')}
          {campo('telefono', 'Teléfono')}
          {campo('leyenda_comprobante', 'Leyenda del comprobante', 'Aclara que es un comprobante interno, no un CFDI.')}
          <Campo etiqueta="Descuento máximo que un vendedor puede aplicar (%)" ayuda="0 = los vendedores no pueden dar descuentos. El administrador no tiene límite.">
            <Entrada type="number" min={0} max={100} step="0.5" value={c.descuento_max_vendedor_pct}
                     onChange={e => setC({ ...c, descuento_max_vendedor_pct: e.target.value as unknown as number })} />
          </Campo>
          {error && <Aviso tipo="error">{error}</Aviso>}
          {ok && <Aviso tipo="exito">Ajustes guardados.</Aviso>}
          <Boton type="submit" grande cargando={guardando}>Guardar ajustes</Boton>
        </form>
      </Tarjeta>
    </>
  );
}
