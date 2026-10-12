import Feature from 'ol/Feature'
import OlMap from 'ol/Map'
import View from 'ol/View'
import Attribution from 'ol/control/Attribution'
import MousePosition from 'ol/control/MousePosition'
import Zoom from 'ol/control/Zoom'
import { createStringXY } from 'ol/coordinate'
import { isEmpty } from 'ol/extent'
import WKT from 'ol/format/WKT'
import type Geometry from 'ol/geom/Geometry'
import type GeometryCollection from 'ol/geom/GeometryCollection'
import Tile from 'ol/layer/Tile'
import VectorLayer from 'ol/layer/Vector'
import { get as getProjection } from 'ol/proj'
import OSM from 'ol/source/OSM'
import VectorSource from 'ol/source/Vector'
import Circle from 'ol/style/Circle'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import Style from 'ol/style/Style'
import Text from 'ol/style/Text'
import 'ol/ol.css'

/**
 * "Use OpenStreetMaps as Base Layer": the OpenLayers map of the GIS visualization (loaded on
 * demand, only when the switch is on).
 * pma: resources/js/table/gis_visualization.ts (OlVisualization), src/Gis/GisVisualization.php::asOl,
 *      src/Gis/GisGeometry.php::prepareRowAsOl
 */

export interface OlGeometryData {
  wkt: string
  srid?: number
  label?: string
}

export interface OlData {
  geometries: OlGeometryData[]
  colors: ReadonlyArray<readonly [number, number, number]>
}

type Rgb = [number, number, number]

/** OlVisualization::getFeaturesFromData */
function featuresFromData(geometries: OlGeometryData[]): Feature[] {
  const features: Feature[] = []
  const addFeature = (index: number, data: OlGeometryData, geometry: Geometry) => {
    const feature = new Feature(geometry)
    feature.set('index', index, true)
    if (data.label) feature.set('label', data.label, true)
    features.push(feature)
  }
  const projections: Record<string, unknown> = {}
  const reader = new WKT()
  geometries.forEach((data, i) => {
    const dataProjection = `EPSG:${data.srid ?? 4326}`
    if (!(dataProjection in projections)) projections[dataProjection] = getProjection(dataProjection)
    // Skip features which use an unknown projection
    if (!projections[dataProjection]) return
    const geometry = reader.readGeometry(data.wkt, { dataProjection, featureProjection: 'EPSG:3857' })
    if (geometry.getType() === 'GeometryCollection') {
      for (const g of (geometry as GeometryCollection).getGeometriesArrayRecursive()) addFeature(i, data, g)
    } else {
      addFeature(i, data, geometry)
    }
  })
  return features
}

const textStyle = () => new Text({ stroke: new Stroke({ width: 2, color: 'white' }) })
const styleFactory: Record<string, (color: Rgb) => Style> = {
  Point: (color) =>
    new Style({
      image: new Circle({
        radius: 3,
        fill: new Fill({ color: 'white' }),
        stroke: new Stroke({ width: 2, color }),
      }),
      text: textStyle(),
    }),
  LineString: (color) => new Style({ stroke: new Stroke({ width: 2, color }), text: textStyle() }),
  Polygon: (color) =>
    new Style({
      fill: new Fill({ color: [...color, 0.8] }),
      stroke: new Stroke({ width: 0.5, color: 'black' }),
      text: textStyle(),
    }),
}

/** OlVisualization::drawOpenLayers */
export function drawOpenLayers(target: HTMLElement, data: OlData): OlMap {
  const vectorSource = new VectorSource({ features: featuresFromData(data.geometries) })
  let currentFeatureIndex: number | undefined
  const colors = data.colors
  const cache: Record<string, Style> = {}
  const vectorLayer = new VectorLayer({
    source: vectorSource,
    style: (feature) => {
      const index = feature.get('index') as number
      const type = (feature.getGeometry()?.getType() ?? 'Point').replace('Multi', '')
      const selected = index === currentFeatureIndex
      const key = `${type}${selected ? '+' : '-'}${index % colors.length}`
      let style = cache[key]
      if (style === undefined) {
        let color = [...(colors[index % colors.length] ?? [0, 0, 0])] as Rgb
        if (selected) color = color.map((c) => c * 1.2) as Rgb
        style = (styleFactory[type] ?? styleFactory.Point)!(color)
        cache[key] = style
      }
      style.getText()?.setText(feature.get('label') as string | undefined)
      return style
    },
  })
  const map = new OlMap({
    target,
    layers: [new Tile({ source: new OSM() }), vectorLayer],
    view: new View({ center: [0, 0], zoom: 4 }),
    controls: [
      new MousePosition({ coordinateFormat: createStringXY(4), projection: 'EPSG:4326' }),
      new Zoom(),
      new Attribution(),
    ],
  })
  map.on('pointermove', (evt) => {
    const newFeatureIndex = map.forEachFeatureAtPixel(evt.pixel, (f) => f)?.get('index') as number | undefined
    if (newFeatureIndex !== currentFeatureIndex) {
      currentFeatureIndex = newFeatureIndex
      vectorLayer.changed()
    }
  })
  const extent = vectorSource.getExtent()
  if (extent !== null && !isEmpty(extent)) map.getView().fit(extent, { padding: [20, 20, 20, 20] })
  return map
}
