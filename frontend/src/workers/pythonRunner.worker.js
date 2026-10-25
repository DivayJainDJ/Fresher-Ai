import { loadPyodide } from 'pyodide'

let pyodidePromise
const loadRuntime = (indexURL) => {
  if (!pyodidePromise) pyodidePromise = loadPyodide({ indexURL })
  return pyodidePromise
}

self.onmessage = async ({ data }) => {
  try {
    const pyodide = await loadRuntime(data.pyodideBaseUrl)
    self.postMessage({ ready: true })
    const fnName = data.functionName
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(fnName)) throw new Error('Invalid solution function name.')
    pyodide.globals.set('_fresherai_source', data.code)
    pyodide.globals.set('_fresherai_tests', JSON.stringify(data.tests))
    pyodide.globals.set('_fresherai_fn_name', fnName)
    const startedAt = performance.now()
    const json = await pyodide.runPythonAsync(`
import json
exec(_fresherai_source, globals())
_fresherai_fn = globals().get(_fresherai_fn_name)
if not callable(_fresherai_fn):
    raise ValueError(f"Define a function named {_fresherai_fn_name}.")
_fresherai_results = []
for _fresherai_test in json.loads(_fresherai_tests):
    _fresherai_actual = _fresherai_fn(*_fresherai_test["input"])
    _fresherai_results.append(json.dumps(_fresherai_actual, sort_keys=True, separators=(",", ":")) == json.dumps(_fresherai_test["expected"], sort_keys=True, separators=(",", ":")))
json.dumps({"passedCount": sum(_fresherai_results), "totalCount": len(_fresherai_results), "results": _fresherai_results})
`)
    self.postMessage({ ...JSON.parse(json), runtimeMs: Math.max(0, Math.round(performance.now() - startedAt)) })
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) })
  }
}
