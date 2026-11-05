import { clamp, driveSpeedRange } from './story'

// A deliberately simple trend estimate, separate from the visual flow field.
// Xiaomi publishes Cd = 0.29 but no speed sweep or calibration conditions.
// We ASSUME a 120 km/h reference and wetted/frontal area ratio of 5, and vary
// only the skin-friction contribution of a fully turbulent smooth flat plate.
// Length is the displayed model's 5.44 m envelope; nu represents room air.
// Cf correlation: NACA TN 4318, figure 5 (not a validated vehicle model).
// https://ntrs.nasa.gov/api/citations/19930085111/downloads/19930085111.pdf
export const referenceCd = 0.29
const referenceKmh = 120
const length = 5.44
const kinematicViscosity = 1.5e-5
const areaRatio = 5

function skinFriction(kmh: number) {
  const reynolds = (kmh / 3.6) * length / kinematicViscosity
  return 0.455 / Math.log10(reynolds) ** 2.58
}

const referenceFriction = skinFriction(referenceKmh)

export function estimateDragCoefficient(kmh: number) {
  const speed = clamp(Number.isFinite(kmh) ? kmh : referenceKmh, driveSpeedRange.min, driveSpeedRange.max)
  return referenceCd + areaRatio * (skinFriction(speed) - referenceFriction)
}
