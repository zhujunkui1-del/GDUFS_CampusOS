export type RenderCapability = {
  webgl2: boolean;
  drawVerified: boolean;
  maxTextureSize: number;
  maxAttributes: number;
  maxRenderbufferSize: number;
  profile: "conservative" | "standard";
  reason: string;
};
/** Tiny draw/readback checks the real API. Memory hints affect budget, never API eligibility. */
export function detectRenderCapability(): RenderCapability {
  const result: RenderCapability = {
    webgl2: false,
    drawVerified: false,
    maxTextureSize: 0,
    maxAttributes: 0,
    maxRenderbufferSize: 0,
    profile: "conservative",
    reason: "webgl2-unavailable",
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext("webgl2", {
      antialias: false,
      powerPreference: "low-power",
    });
    if (!gl) return result;
    result.webgl2 = true;
    result.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    result.maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    result.maxRenderbufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const shader = (kind: number, text: string) => {
      const s = gl!.createShader(kind)!;
      gl!.shaderSource(s, text);
      gl!.compileShader(s);
      return s;
    };
    const vertex = shader(
        gl.VERTEX_SHADER,
        "#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}",
      ),
      fragment = shader(
        gl.FRAGMENT_SHADER,
        "#version 300 es\nprecision mediump float;out vec4 color;void main(){color=vec4(1,0,0,1);}",
      );
    const program = gl.createProgram()!;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    result.drawVerified =
      !!gl.getProgramParameter(program, gl.LINK_STATUS) &&
      !gl.isContextLost() &&
      gl.getError() === gl.NO_ERROR &&
      pixel[0] > 200;
    gl.deleteProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    const memory = (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory;
    result.profile =
      (memory && memory < 4) ||
      result.maxTextureSize < 8192 ||
      matchMedia("(pointer:coarse)").matches
        ? "conservative"
        : "standard";
    result.reason = result.drawVerified ? "verified" : "webgl2-draw-failed";
  } catch {
    result.reason = "webgl2-initialization-failed";
  } finally {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.width = canvas.height = 0;
  }
  return result;
}
