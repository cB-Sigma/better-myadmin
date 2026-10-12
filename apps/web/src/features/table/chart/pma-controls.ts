/**
 * phpMyAdmin controls of Display chart (parity registry, read statically by tools/parity).
 * pma: resources/templates/table/chart/tbl_chart.twig, table/start_and_number_of_rows_fieldset.twig
 */
export const pmaControls = {
  'table/chart/tbl_chart.twig#chartType': { file: 'ChartPage.tsx', match: 'name="chartType"' },
  'table/chart/tbl_chart.twig#barStackedCheckbox': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#chartTitleInput': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#chartXAxisSelect': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#chartSeriesSelect': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#xAxisLabelInput': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#yAxisLabelInput': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#seriesColumnCheckbox': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#chartSeriesColumnSelect': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#chartValueColumnSelect': 'ChartPage.tsx',
  'table/chart/tbl_chart.twig#link:Save chart as image': 'ChartPage.tsx',
  // the fieldset is shared with the GIS visualization (RowsFieldsetInputs)
  'table/start_and_number_of_rows_fieldset.twig#pos': { file: 'ChartPage.tsx', match: 'name="pos"' },
  'table/start_and_number_of_rows_fieldset.twig#session_max_rows': 'ChartPage.tsx',
  'table/start_and_number_of_rows_fieldset.twig#submit': { file: 'ChartPage.tsx', match: 'name="submit"' },
  // pma: resources/js — browser behaviours (js.json)
  "js:table/chart.ts#ajax:POST <$form.attr('action')>": {
    file: 'ChartPage.tsx',
    match: 'api.chartData(scope',
  },
  'js:table/chart.ts#blur:#chartTitleInput': {
    file: 'ChartPage.tsx',
    match: 'set({ title: e.target.value })',
  },
  'js:table/chart.ts#focus:#chartTitleInput': {
    file: 'ChartPage.tsx',
    match: 'set({ title: e.target.value })',
  },
  'js:table/chart.ts#keyup:#chartTitleInput': {
    file: 'ChartPage.tsx',
    match: 'set({ title: e.target.value })',
  },
  'js:table/chart.ts#change:#chartSeriesColumnSelect': {
    file: 'ChartPage.tsx',
    match: 'setSeriesColumn(Number(e.target.value))',
  },
  'js:table/chart.ts#change:#chartSeriesSelect': {
    file: 'ChartPage.tsx',
    match: 'onSeries([...e.target.selectedOptions]',
  },
  'js:table/chart.ts#change:#chartValueColumnSelect': {
    file: 'ChartPage.tsx',
    match: 'setValueColumn(Number(e.target.value))',
  },
  'js:table/chart.ts#change:#chartXAxisSelect': {
    file: 'ChartPage.tsx',
    match: 'onXAxis(Number(e.target.value))',
  },
  'js:table/chart.ts#click:#barStackedCheckbox': {
    file: 'ChartPage.tsx',
    match: 'set({ stackSeries: e.target.checked })',
  },
  'js:table/chart.ts#click:#seriesColumnCheckbox': {
    file: 'ChartPage.tsx',
    match: '{ seriesColumn: null, valueColumn: null }',
  },
  'js:table/chart.ts#click:input[name="chartType"]': {
    file: 'ChartPage.tsx',
    match: 'onChange={() => onType(type)}',
  },
  'js:table/chart.ts#keyup:#xAxisLabelInput': {
    file: 'ChartPage.tsx',
    match: 'set({ xaxisLabel: e.target.value })',
  },
  'js:table/chart.ts#keyup:#yAxisLabelInput': {
    file: 'ChartPage.tsx',
    match: 'set({ yaxisLabel: e.target.value })',
  },
  "js:table/chart.ts#submit:<$('#tblchartform') as JQuery<HTMLFormEl…>": {
    file: 'ChartPage.tsx',
    match: 'id="tblchartform"',
  },
}
