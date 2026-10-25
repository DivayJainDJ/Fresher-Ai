const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

self.onmessage = async ({ data }) => {
  const { code, functionName, tests } = data
  try {
    const fn = new Function(`${code}\n;return typeof ${functionName} === "function" ? ${functionName} : null;`)()
    if (typeof fn !== 'function') throw new Error(`Define a function named ${functionName}.`)
    const results = []
    for (const test of tests) {
      const actual = await fn(...test.input)
      results.push(stableStringify(actual) === stableStringify(test.expected))
    }
    self.postMessage({ passedCount: results.filter(Boolean).length, totalCount: results.length, results })
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) })
  }
}
