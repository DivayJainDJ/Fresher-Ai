const normalizeCell = (value) => {
  if (value instanceof Uint8Array) return Array.from(value)
  return value
}

const normalizeRows = (rows) => rows.map((row) => row.map(normalizeCell))
const stableRow = (row) => JSON.stringify(row)

export const sqlResultsMatch = (actual, expected, orderSensitive = false) => {
  if (!actual || !expected || !Array.isArray(actual.columns) || !Array.isArray(actual.rows)) return false
  if (actual.columns.length !== expected.columns?.length || actual.rows.length !== expected.rows?.length) return false
  if (!actual.columns.every((column, index) => column === expected.columns[index])) return false

  const actualRows = normalizeRows(actual.rows)
  const expectedRows = normalizeRows(expected.rows)
  if (!orderSensitive) {
    actualRows.sort((left, right) => stableRow(left).localeCompare(stableRow(right)))
    expectedRows.sort((left, right) => stableRow(left).localeCompare(stableRow(right)))
  }
  return actualRows.every((row, index) => stableRow(row) === stableRow(expectedRows[index]))
}

export const runInDisposableDatabase = (SQL, problem, query) => {
  const database = new SQL.Database()
  try {
    database.exec(problem.schemaSql)
    database.exec(problem.seedSql)
    const resultSets = database.exec(query)
    if (resultSets.length !== 1) return { passed: false, actual: null, message: "Write a query that returns one result set." }
    const result = { columns: resultSets[0].columns, rows: resultSets[0].values }
    return { passed: sqlResultsMatch(result, problem.expectedResult, problem.orderSensitive), actual: result }
  } catch (error) {
    return { passed: false, actual: null, message: error.message }
  } finally {
    database.close()
  }
}
