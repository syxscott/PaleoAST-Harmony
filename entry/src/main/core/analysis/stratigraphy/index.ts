// Re-export everything from the consolidated stratigraphy module.
export * from './stratigraphy';
export {
  brokenStickTest,
  pyperPetermanCorrection,
  pchipInterpolate,
  pchipSlopes,
  computePaleotemperatureErezLuz,
  computePaleotemperatureBemis,
  computePaleotemperatureKimONeil,
  blockBootstrapCI,
  optimalBlockSize,
  binForRose,
  detectCyclicContradictions,
  findSignificantPeaks,
  mexicanHatWavelet,
  fourierWaveFrequency,
  dtwSimilarity,
  type BrokenStickResult,
  type PyperPetermanResult,
  type CyclicContradiction,
  type SpectralPeak,
} from './StratExtended';
