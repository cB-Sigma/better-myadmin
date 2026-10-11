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
}
