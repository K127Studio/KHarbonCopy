/** User-adjustable constants that scale each component of the style model when transferring. */
export interface TransferParams {
  /** multiplier of the measured slant (shear) */
  slant: number;
  /** multiplier of the measured horizontal scale deviation (sx-1) */
  width: number;
  /** vertical scale (1 = unchanged) */
  height: number;
  /** 0..1: blend from Khmer native weight to the source's relative weight */
  weight: number;
  /** extra uniform offset (units, 1000 em) on top of the weight match */
  weightBias: number;
  /** multiplier of the anisotropic (contrast/stress) harmonics of O(φ) */
  contrast: number;
  /** contrast transfer: "absolute" matches the source h/v stem ratio, "relative" adds Δ vs reference */
  contrastMode: "absolute" | "relative";
  /** number of Fourier harmonics of O(φ) used (≤ fitted) */
  harmonics: number;
  /** corner fillet radius multiplier */
  cornerRadius: number;
  /** corner residual profile multiplier (ink traps, flares, spurs) */
  cornerDetail: number;
  /** stroke-terminal profile multiplier (flared / cut / rounded stroke ends) */
  terminalDetail: number;
  /** warp field multiplier */
  warp: number;
  /** thickness field multiplier */
  thickness: number;
  /** texture amplitude multiplier */
  texture: number;
  /** texture wavelength multiplier */
  textureScale: number;
  /** "tape": replay measured residual signals · "spectral": synthesise from PSD (random phases) */
  textureMode: "tape" | "spectral";
  /** amplitude modulation by normal direction (0 = isotropic, 1 = measured) */
  textureAniso: number;
  /** random seed for texture */
  seed: number;
  /** size scale for corner/texture lengths: "auto" = Khmer body / source x-height */
  detailScale: number;
  /** extra side bearing per side (units, 1000 em) */
  tracking: number;
  /** outline sampling step (units, 1000 em) */
  step: number;
  /** curve-fit tolerance (units, 1000 em) */
  fitTolerance: number;
  /** gaussian smoothing of the structural displacement along the outline (units, scaled by stem) */
  smoothing: number;
  /** remove islands / pin-holes smaller than (despeckle · stem)² */
  despeckle: number;
  /** max fraction of each whitespace gap (counters, slots, notches, inter-stroke space) that ink may fill */
  counterKeep: number;
  /** minimum fraction of every stroke that must survive thinning */
  strokeKeep: number;
  /** O(phi) spectral smoothness: harmonics above this order are progressively damped (0 = off) */
  waveSmooth: number;
  /** pick the Khmer variable-font instance whose stems best match the target weight */
  useAxes: boolean;
}

export const DEFAULT_PARAMS: TransferParams = {
  slant: 1,
  width: 1,
  height: 1,
  weight: 1,
  weightBias: 0,
  contrast: 1,
  contrastMode: "absolute",
  harmonics: 12,
  cornerRadius: 1,
  cornerDetail: 1,
  terminalDetail: 1,
  warp: 1,
  thickness: 1,
  texture: 1,
  textureScale: 1,
  textureMode: "tape",
  textureAniso: 1,
  seed: 1,
  detailScale: 0,
  tracking: 0,
  step: 1,
  fitTolerance: 0.1,
  useAxes: true,
  counterKeep: 0.35,
  strokeKeep: 0.45,
  waveSmooth: 4,
  smoothing: 8,
  despeckle: 0.2,
};
