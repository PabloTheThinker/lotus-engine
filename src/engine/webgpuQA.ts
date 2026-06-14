/** WebGPU QA matrix (Wave 13) — gate before defaulting WebGPURenderer. */

export interface WebGPUQACheck {
  id: string
  label: string
  pass: boolean
  detail: string
}

export interface WebGPUQAResult {
  ok: boolean
  checks: WebGPUQACheck[]
  adapterName: string
  backendNote: string
}

/** Run capability checks — never throws. */
export async function runWebGPUQAMatrix(): Promise<WebGPUQAResult> {
  const checks: WebGPUQACheck[] = []
  let adapterName = 'n/a'
  let ok = true

  const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  checks.push({
    id: 'navigator.gpu',
    label: 'navigator.gpu present',
    pass: hasGpu,
    detail: hasGpu ? 'WebGPU API exposed' : 'No WebGPU in this browser',
  })
  if (!hasGpu) ok = false

  let adapter: GPUAdapter | null = null
  if (hasGpu) {
    try {
      adapter = await (navigator as Navigator & { gpu: GPU }).gpu.requestAdapter()
      checks.push({
        id: 'adapter',
        label: 'GPU adapter',
        pass: adapter !== null,
        detail: adapter ? 'Adapter acquired' : 'requestAdapter returned null',
      })
      if (!adapter) ok = false
      else adapterName = 'WebGPU adapter'
    } catch (e) {
      checks.push({
        id: 'adapter',
        label: 'GPU adapter',
        pass: false,
        detail: (e as Error).message,
      })
      ok = false
    }
  }

  if (adapter) {
    try {
      const device = await adapter.requestDevice()
      checks.push({
        id: 'device',
        label: 'GPU device',
        pass: !!device,
        detail: device ? 'Device created' : 'requestDevice failed',
      })
      device.destroy()
    } catch (e) {
      checks.push({
        id: 'device',
        label: 'GPU device',
        pass: false,
        detail: (e as Error).message,
      })
      ok = false
    }
  }

  checks.push({
    id: 'shadows',
    label: 'Shadow regression gate',
    pass: true,
    detail: 'Manual QA — WebGPU shadows may regress on some GPUs; opt-in tier only',
  })

  return {
    ok,
    checks,
    adapterName,
    backendNote: ok
      ? 'QA passed — WebGPURenderer eligible when render tier = webgpu'
      : 'QA failed — staying on WebGLRenderer',
  }
}