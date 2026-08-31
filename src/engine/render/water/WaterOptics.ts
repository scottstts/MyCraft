/** Shared scene-linear optical coefficients for the rendered water medium. */
export const WATER_IOR = 1.333

/** Virtual receiver depth represented by the bounded caustic tile. */
export const CAUSTIC_REFERENCE_DEPTH = 24.0

/** Linear encoding scale used for both float and byte caustic targets. */
export const CAUSTIC_FIELD_SCALE = 4.0

/** Absorption coefficients in inverse world metres (red, green, blue). */
export const WATER_ABSORPTION = [0.075, 0.018, 0.005] as const

/** Scattering coefficients in inverse world metres (red, green, blue). */
export const WATER_SCATTERING = [0.012, 0.028, 0.040] as const

/** Extinction used for the direct sunlight path through water. */
export const WATER_EXTINCTION: readonly [number, number, number] = [
  WATER_ABSORPTION[0] + WATER_SCATTERING[0],
  WATER_ABSORPTION[1] + WATER_SCATTERING[1],
  WATER_ABSORPTION[2] + WATER_SCATTERING[2],
]
