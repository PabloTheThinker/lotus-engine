import type { AttenuationCurve, AttenuationSettings } from '../../engine/types'
import { DEFAULT_ATTENUATION } from '../../engine/types'

const CURVE_LABELS: Record<AttenuationCurve, string> = {
  linear: 'Linear',
  inverse: 'Inverse',
  inverseSquare: 'Inverse Square',
  custom: 'Custom',
}

interface AttenuationFieldsProps {
  value: AttenuationSettings
  onChange: (patch: Partial<AttenuationSettings>) => void
}

export function AttenuationFields({ value, onChange }: AttenuationFieldsProps) {
  const falloff = value.falloff ?? DEFAULT_ATTENUATION.falloff ?? 'inverse'
  const minDistance = value.minDistance ?? DEFAULT_ATTENUATION.minDistance ?? 1
  const maxDistance = value.maxDistance ?? DEFAULT_ATTENUATION.maxDistance ?? 80
  const customCurve = value.customCurve ?? DEFAULT_ATTENUATION.customCurve ?? [[0, 1], [1, 0]]

  return (
    <>
      <label className="field">
        <span>Falloff</span>
        <select value={falloff} onChange={(e) => onChange({ falloff: e.target.value as AttenuationCurve })}>
          {(Object.keys(CURVE_LABELS) as AttenuationCurve[]).map((c) => (
            <option key={c} value={c}>
              {CURVE_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Min Distance</span>
        <input
          type="number"
          min={0.01}
          step={0.5}
          value={minDistance}
          onChange={(e) => onChange({ minDistance: Math.max(0.01, parseFloat(e.target.value) || 1) })}
        />
      </label>
      <label className="field">
        <span>Max Distance</span>
        <input
          type="number"
          min={0.1}
          step={1}
          value={maxDistance}
          onChange={(e) => onChange({ maxDistance: Math.max(0.1, parseFloat(e.target.value) || 80) })}
        />
      </label>
      {falloff === 'custom' && (
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>Custom Curve</span>
          <input
            spellCheck={false}
            value={customCurve.map(([d, v]) => `${d},${v}`).join(' ')}
            title="Normalized distance→volume points (0–1), e.g. 0,1 0.5,0.5 1,0"
            onChange={(e) => {
              const pts: [number, number][] = []
              for (const part of e.target.value.split(/\s+/)) {
                const [d, v] = part.split(',').map(Number)
                if (Number.isFinite(d) && Number.isFinite(v)) pts.push([d, v])
              }
              if (pts.length >= 2) onChange({ customCurve: pts })
            }}
          />
        </label>
      )}
    </>
  )
}