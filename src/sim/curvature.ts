import * as THREE from 'three';

/** 地球の曲率 (R=6371km) を頂点シェーダで表現 */
export const CURVATURE_GLSL = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 cwp = modelMatrix * mvPosition;
vec2 cdd = cwp.xz - cameraPosition.xz;
cwp.y -= dot(cdd, cdd) * 7.848e-8;
mvPosition = viewMatrix * cwp;
gl_Position = projectionMatrix * mvPosition;
`;

export function applyCurvature<T extends THREE.Material>(mat: T, key = 'curv'): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', CURVATURE_GLSL);
  };
  mat.customProgramCacheKey = () => key + mat.type;
  return mat;
}
