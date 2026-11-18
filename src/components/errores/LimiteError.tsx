'use client'

/**
 * Red de seguridad por pantalla (sql/118): si un componente de adentro revienta, se muestra un aviso amable y fijo
 * (nunca pantalla blanca), el error se anota para el administrador y la persona puede «Reintentar» o «Avisar al
 * administrador» (manda el reporte en el acto).
 */

import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'
import { Alerta, Boton, Tarjeta } from '@/components/ui/Primitivos'
import { enviarPendientes, registrarError } from '@/lib/errores/registrador'

type Props = { modulo: string; children: ReactNode }
type Estado = { error: Error | null; clave: number; huella: string | null; aviso: string | null; avisando: boolean }

export class LimiteError extends Component<Props, Estado> {
  state: Estado = { error: null, clave: 0, huella: null, aviso: null, avisando: false }

  static getDerivedStateFromError(error: Error): Partial<Estado> {
    return { error, aviso: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const huella = registrarError(error, {
      origen: 'pantalla',
      modulo: this.props.modulo,
      severidad: 'error',
      detalle: { componente: (info.componentStack ?? '').split('\n').slice(0, 6).join('\n') },
    })
    this.setState({ huella })
  }

  private reintentar = () => this.setState((s) => ({ error: null, aviso: null, clave: s.clave + 1 }))

  private avisar = async () => {
    this.setState({ avisando: true })
    const r = await enviarPendientes(true)
    this.setState({
      avisando: false,
      aviso:
        r.pendientes === 0
          ? 'Listo: el administrador ya recibió el aviso.'
          : 'El aviso quedó guardado en el teléfono y se enviará en cuanto haya señal.',
    })
  }

  render() {
    if (!this.state.error) return <Fragment key={this.state.clave}>{this.props.children}</Fragment>
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-3 p-4" data-limite-error>
        <Tarjeta className="flex flex-col gap-3 p-5">
          <h2 className="break-words text-lg font-bold tracking-tight text-slate-900">Algo falló en esta pantalla</h2>
          <p className="break-words text-sm text-slate-600">Lo que ya guardaste está a salvo.</p>
          <div className="flex flex-wrap gap-2">
            <Boton onClick={this.reintentar} data-reintentar>
              Reintentar
            </Boton>
            <Boton variante="secundario" onClick={this.avisar} disabled={this.state.avisando} data-avisar-admin>
              {this.state.avisando ? 'Enviando…' : 'Avisar al administrador'}
            </Boton>
          </div>
          {this.state.aviso && <Alerta tono="azul">{this.state.aviso}</Alerta>}
          {this.state.huella && <p className="break-all text-xs text-slate-500">Código de soporte: {this.state.huella}</p>}
        </Tarjeta>
      </div>
    )
  }
}
