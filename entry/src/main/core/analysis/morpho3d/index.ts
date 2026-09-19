export { Quaternion, RotationMatrix } from './Quaternion';
export { gpa3d, GPA3D, partialGPA3D, computePartialGPA, procrustesDistance3D, computeProcrustesDistanceMatrix } from './GPA3D';
export { computeNormals, meshArea, SurfaceInterpolator, computeEdges, computeVolume, samplePoints } from './Mesh';
export { tps3dFit, tps3DDeform, TPS3D, transformPoints, createDeformationGrid, computeJacobian, interpolateTPS3D, tps3dKernelValue } from './TPS3D';
export { slideLandmarks, slideLandmarksSimple, slideLandmarksMulti, SemiLandmarkSlider, slideCurveSemiLandmarks, slideSurfaceSemiLandmarks } from './Sliding';

// Result / option shapes are TYPE-ONLY. Re-exporting them through a value
// export list makes the module graph fail to instantiate outside the
// hvigor/TS pipeline ("does not provide an export named 'GPA3DResult'").
export type { GPA3DResult, GPA3DOptions } from './GPA3D';
export type { Mesh3D, MeshEdge } from './Mesh';
export type { TPS3DResult, TPS3DKernel, TPS3DFitOptions } from './TPS3D';
export type {
  SemiLandmarkSliderOptions, SlidingResult, SlidingMode, SlidingCriterion, SlideResult,
} from './Sliding';
