/** Curve assets (Wave 12) — UE CurveFloat analog for data-driven tuning. */

export interface CurveKey {
  t: number
  v: number
}

export interface CurveAsset {
  name: string
  keys: CurveKey[]
  /** pre/post extrapolation */
  preInfinity?: 'constant' | 'linear'
  postInfinity?: 'constant' | 'linear'
}

export interface DataTableColumn {
  name: string
  type: 'string' | 'number' | 'bool'
}

export interface DataTableAsset {
  name: string
  columns: DataTableColumn[]
  rows: Record<string, string | number | boolean>[]
}

export function isCurveAsset(v: unknown): v is CurveAsset {
  return !!v && typeof v === 'object' && Array.isArray((v as CurveAsset).keys)
}

export function isDataTableAsset(v: unknown): v is DataTableAsset {
  return !!v && typeof v === 'object' && Array.isArray((v as DataTableAsset).columns)
}

/** Sample a curve at normalized or absolute t. */
export function evaluateCurve(curve: CurveAsset, t: number): number {
  const keys = [...curve.keys].sort((a, b) => a.t - b.t)
  if (!keys.length) return 0
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t)
      return a.v + (b.v - a.v) * u
    }
  }
  return keys[0].v
}

export function emptyCurve(name: string): CurveAsset {
  return {
    name,
    keys: [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
    ],
  }
}

export function emptyDataTable(name: string): DataTableAsset {
  return {
    name,
    columns: [
      { name: 'id', type: 'string' },
      { name: 'value', type: 'number' },
    ],
    rows: [{ id: 'row0', value: 0 }],
  }
}