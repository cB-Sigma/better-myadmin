/**
 * phpMyAdmin controls of the GIS visualization (parity registry, read statically by tools/parity).
 * pma: resources/templates/table/gis_visualization/gis_visualization.twig
 */
export const pmaControls = {
  'table/gis_visualization/gis_visualization.twig#visualizationSettings[labelColumn]':
    'GisVisualizationPage.tsx',
  'table/gis_visualization/gis_visualization.twig#visualizationSettings[spatialColumn]':
    'GisVisualizationPage.tsx',
  'table/gis_visualization/gis_visualization.twig#useBaseLayer': 'GisVisualizationPage.tsx',
  'table/gis_visualization/gis_visualization.twig#id:saveImageButton': 'GisVisualizationPage.tsx',
  // pma: resources/js — browser behaviours (js.json)
  'js:table/gis_visualization.ts#click:#useOsmAsBaseLayerSwitch': {
    file: 'GisVisualizationPage.tsx',
    match: 'setUseBaseLayer(e.target.checked)',
  },
  'js:table/gis_visualization.ts#click:<this.target> .down_arrow': {
    file: 'GisVisualizationPage.tsx',
    match: "'down_arrow'",
  },
  'js:table/gis_visualization.ts#click:<this.target> .left_arrow': {
    file: 'GisVisualizationPage.tsx',
    match: "'left_arrow'",
  },
  'js:table/gis_visualization.ts#click:<this.target> .right_arrow': {
    file: 'GisVisualizationPage.tsx',
    match: "'right_arrow'",
  },
  'js:table/gis_visualization.ts#click:<this.target> .up_arrow': {
    file: 'GisVisualizationPage.tsx',
    match: "'up_arrow'",
  },
  'js:table/gis_visualization.ts#click:<this.target> .zoom_in': {
    file: 'GisVisualizationPage.tsx',
    match: "'zoom_in'",
  },
  'js:table/gis_visualization.ts#click:<this.target> .zoom_out': {
    file: 'GisVisualizationPage.tsx',
    match: "'zoom_out'",
  },
  'js:table/gis_visualization.ts#click:<this.target> .zoom_world': {
    file: 'GisVisualizationPage.tsx',
    match: "'zoom_world'",
  },
  'js:table/gis_visualization.ts#dblclick:<this.svgEl>': {
    file: 'GisVisualizationPage.tsx',
    match: 'onDoubleClick={(e) => zoomAt(rel(e), ZOOM_FACTOR)}',
  },
  'js:table/gis_visualization.ts#drag:<this.svgEl>': {
    file: 'GisVisualizationPage.tsx',
    match: 'const onPointerMove',
  },
  'js:table/gis_visualization.ts#dragstart:<this.svgEl>': {
    file: 'GisVisualizationPage.tsx',
    match: 'setPointerCapture',
  },
  'js:table/gis_visualization.ts#dragstart:<this.target> .button': {
    file: 'GisVisualizationPage.tsx',
    match: 'onDragStart={(e) => e.preventDefault()}',
  },
  'js:table/gis_visualization.ts#mouseleave:<this.svgEl> .vector': {
    file: 'GisVisualizationPage.tsx',
    match: 'onMouseLeave={() => setTip(null)}',
  },
  'js:table/gis_visualization.ts#mousemove:<this.svgEl> .vector': {
    file: 'GisVisualizationPage.tsx',
    match: 'setTip({ text: label',
  },
  'js:table/gis_visualization.ts#pointermove:<map>': { file: 'olMap.ts', match: "map.on('pointermove'" },
  'js:table/gis_visualization.ts#resize:window': {
    file: 'GisVisualizationPage.tsx',
    match: "window.addEventListener('resize', onResize)",
  },
  'js:table/gis_visualization.ts#wheel:<this.svgEl>': {
    file: 'GisVisualizationPage.tsx',
    match: "addEventListener('wheel', onWheel, { passive: false })",
  },
}
