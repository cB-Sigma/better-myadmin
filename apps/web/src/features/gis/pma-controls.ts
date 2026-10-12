/**
 * phpMyAdmin controls of the GIS visualization (parity registry, read statically by tools/parity).
 * The OpenStreetMaps base layer switch (`useBaseLayer`) is not ported (no OpenLayers).
 * pma: resources/templates/table/gis_visualization/gis_visualization.twig
 */
export const pmaControls = {
  'table/gis_visualization/gis_visualization.twig#visualizationSettings[labelColumn]':
    'GisVisualizationPage.tsx',
  'table/gis_visualization/gis_visualization.twig#visualizationSettings[spatialColumn]':
    'GisVisualizationPage.tsx',
  'table/gis_visualization/gis_visualization.twig#id:saveImageButton': 'GisVisualizationPage.tsx',
}
