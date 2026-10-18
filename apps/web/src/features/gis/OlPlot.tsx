import { useEffect, useRef } from 'react'
import type { OlData } from './olMap'

/** OlVisualization: the OpenStreetMaps map, created the first time the switch shows it */
export function OlPlot({ data, visible }: { data: OlData; visible: boolean }) {
  const target = useRef<HTMLDivElement>(null)
  const map = useRef<{ updateSize(): void; setTarget(t: undefined): void } | null>(null)
  useEffect(() => {
    if (!visible || target.current === null) return
    if (map.current !== null) {
      map.current.updateSize()
      return
    }
    const el = target.current
    let cancelled = false
    // gis_data_editor.ts loadJSAndGISEditor: the editor goes on whether OpenLayers loads or not
    import('./olMap')
      .then(({ drawOpenLayers }) => {
        if (!cancelled && map.current === null) map.current = drawOpenLayers(el, data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [visible, data])
  // Removes ol.Map's resize listener from window
  useEffect(
    () => () => {
      map.current?.setTarget(undefined)
      map.current = null
    },
    [],
  )
  return (
    <div
      ref={target}
      className={`visualization-target visualization-target-ol h-full ${visible ? '' : 'hidden'}`}
    />
  )
}
