// Boot-time capability check. The architecture doc's colour and state decisions
// (linear float16 throughout, float ping-pong state) are not negotiable, so a
// missing extension is a hard failure rather than a silent downgrade.

const REQUIRED = [
  ['EXT_color_buffer_float', 'float / half-float render targets — every intermediate buffer and all simulation state'],
  ['OES_texture_float_linear', 'linear filtering of float textures — smooth sampling of state and HDR buffers'],
];

export function checkCapabilities(renderer) {
  const gl = renderer.getContext();
  const missing = [];

  if (!renderer.capabilities.isWebGL2) {
    missing.push(['WebGL2', 'texelFetch, gl_VertexID, MRT, GLSL ES 3.00 — the whole prototype assumes it']);
  }

  for (const [name, why] of REQUIRED) {
    if (!gl.getExtension(name)) missing.push([name, why]);
  }

  return {
    ok: missing.length === 0,
    missing,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxDrawBuffers: renderer.capabilities.isWebGL2 ? gl.getParameter(gl.MAX_DRAW_BUFFERS) : 1,
    renderer: describeGpu(gl),
  };
}

function describeGpu(gl) {
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (!dbg) return 'unknown gpu';
  return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || 'unknown gpu';
}

export function reportFatal(lines) {
  const el = document.getElementById('fatal');
  el.innerHTML = lines;
  el.classList.add('show');
}
