import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { WindField, WindSample } from "../data/wind";
import { DARK_WIND_SPEED_COLORS } from "../data/wind-colors";

interface WindParticlesProps {
  map: MapLibreMap | null;
  field: WindField | null;
  isPlaying: boolean;
  darkMode: boolean;
}

interface Particle {
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  east: number;
  north: number;
  life: number;
  maxLife: number;
  speed: number;
}

interface ProjectedSample {
  x: number;
  y: number;
  sample: WindSample;
}

const PARTICLE_COUNT = 1200;
const PARTICLE_LENGTH_MULTIPLIER = 100;
const PARTICLE_SIZE_FACTOR = 0.6;
const WIND_INTERPOLATION_NEIGHBORS = 4;
const PARTICLE_MIN_LIFETIME = 480;
const PARTICLE_LIFETIME_VARIATION = 360;
const PARTICLE_FADE_IN = 24;
const PARTICLE_FADE_OUT = 60;

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

const DARK_PARTICLE_COLORS = [
  hexToRgb(DARK_WIND_SPEED_COLORS.low),
  hexToRgb(DARK_WIND_SPEED_COLORS.mild),
  hexToRgb(DARK_WIND_SPEED_COLORS.moderate),
  hexToRgb(DARK_WIND_SPEED_COLORS.strong),
  hexToRgb(DARK_WIND_SPEED_COLORS.severe),
] as const;

const vertexShaderSource = `
  attribute vec2 a_position;
  attribute float a_alpha;
  attribute float a_speed;
  uniform vec2 u_resolution;
  varying float v_alpha;
  varying float v_speed;

  void main() {
    vec2 clip = (a_position / u_resolution) * 2.0 - 1.0;
    gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    v_alpha = a_alpha;
    v_speed = a_speed;
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying float v_alpha;
  varying float v_speed;
  uniform float u_dark_mode;
  uniform vec3 u_dark_low;
  uniform vec3 u_dark_mild;
  uniform vec3 u_dark_moderate;
  uniform vec3 u_dark_strong;
  uniform vec3 u_dark_severe;

  vec3 getWindColor(float speed) {
    if (u_dark_mode > 0.5) {
      if (speed <= 15.0) return u_dark_low;
      if (speed <= 30.0) return u_dark_mild;
      if (speed <= 45.0) return u_dark_moderate;
      if (speed <= 60.0) return u_dark_strong;
      return u_dark_severe;
    }
    if (speed <= 15.0) return vec3(0.043, 0.302, 0.416);
    if (speed <= 30.0) return vec3(0.114, 0.306, 0.847);
    if (speed <= 45.0) return vec3(0.357, 0.129, 0.714);
    if (speed <= 60.0) return vec3(0.522, 0.098, 0.561);
    return vec3(0.602, 0.204, 0.055);
  }

  void main() {
    gl_FragColor = vec4(getWindColor(v_speed), v_alpha);
  }
`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to create the WebGL shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource,
  );
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Unable to create the WebGL particle program.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "Unknown link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function interpolateWind(
  x: number,
  y: number,
  samples: ProjectedSample[],
): Pick<WindSample, "east" | "north" | "speed"> | undefined {
  const nearest: ProjectedSample[] = [];
  const distances: number[] = [];

  for (const projected of samples) {
    const distance = (projected.x - x) ** 2 + (projected.y - y) ** 2;
    if (distance === 0) {
      return projected.sample;
    }

    let index = 0;
    while (index < distances.length && distances[index] <= distance) {
      index += 1;
    }
    if (index < WIND_INTERPOLATION_NEIGHBORS) {
      nearest.splice(index, 0, projected);
      distances.splice(index, 0, distance);
      if (nearest.length > WIND_INTERPOLATION_NEIGHBORS) {
        nearest.pop();
        distances.pop();
      }
    }
  }

  if (nearest.length === 0) {
    return undefined;
  }

  let totalWeight = 0;
  let east = 0;
  let north = 0;
  for (let index = 0; index < nearest.length; index += 1) {
    const weight = 1 / distances[index];
    totalWeight += weight;
    east += nearest[index].sample.east * weight;
    north += nearest[index].sample.north * weight;
  }

  east /= totalWeight;
  north /= totalWeight;
  return { east, north, speed: Math.hypot(east, north) };
}

function createParticle(
  width: number,
  height: number,
  samples: ProjectedSample[],
): Particle {
  const x = Math.random() * width;
  const y = Math.random() * height;
  const wind = interpolateWind(x, y, samples);
  const maxLife =
    PARTICLE_MIN_LIFETIME + Math.random() * PARTICLE_LIFETIME_VARIATION;

  return {
    x,
    y,
    previousX: x,
    previousY: y,
    east: wind?.east ?? 0,
    north: wind?.north ?? 0,
    life: Math.random() * maxLife,
    maxLife,
    speed: wind?.speed ?? 0,
  };
}

export function WindParticles({
  map,
  field,
  isPlaying,
  darkMode,
}: WindParticlesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map || !field || !isPlaying) {
      if (canvas) {
        const gl = canvas.getContext("webgl");
        gl?.clearColor(0, 0, 0, 0);
        gl?.clear(gl.COLOR_BUFFER_BIT);
      }
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      console.warn("WebGL is unavailable; wind particles cannot be rendered.");
      return;
    }

    let program: WebGLProgram;
    try {
      program = createProgram(gl);
    } catch (error) {
      console.error(
        "Unable to initialize the WebGL wind particle renderer.",
        error,
      );
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const alphaLocation = gl.getAttribLocation(program, "a_alpha");
    const speedLocation = gl.getAttribLocation(program, "a_speed");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const darkModeLocation = gl.getUniformLocation(program, "u_dark_mode");
    const darkLowLocation = gl.getUniformLocation(program, "u_dark_low");
    const darkMildLocation = gl.getUniformLocation(program, "u_dark_mild");
    const darkModerateLocation = gl.getUniformLocation(
      program,
      "u_dark_moderate",
    );
    const darkStrongLocation = gl.getUniformLocation(program, "u_dark_strong");
    const darkSevereLocation = gl.getUniformLocation(program, "u_dark_severe");

    if (
      positionLocation < 0 ||
      alphaLocation < 0 ||
      speedLocation < 0 ||
      !resolutionLocation ||
      !darkModeLocation ||
      !darkLowLocation ||
      !darkMildLocation ||
      !darkModerateLocation ||
      !darkStrongLocation ||
      !darkSevereLocation
    ) {
      gl.deleteProgram(program);
      console.error("The WebGL wind particle shader has an invalid interface.");
      return;
    }

    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      return;
    }

    gl.useProgram(program);
    gl.uniform1f(darkModeLocation, darkMode ? 1 : 0);
    gl.uniform3fv(darkLowLocation, DARK_PARTICLE_COLORS[0]);
    gl.uniform3fv(darkMildLocation, DARK_PARTICLE_COLORS[1]);
    gl.uniform3fv(darkModerateLocation, DARK_PARTICLE_COLORS[2]);
    gl.uniform3fv(darkStrongLocation, DARK_PARTICLE_COLORS[3]);
    gl.uniform3fv(darkSevereLocation, DARK_PARTICLE_COLORS[4]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let projectedSamples: ProjectedSample[] = [];
    let particles: Particle[] = [];
    let animationFrame = 0;

    const getMapSize = () => ({
      width: map.getCanvas().clientWidth,
      height: map.getCanvas().clientHeight,
    });

    const resize = () => {
      const { width, height } = getMapSize();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

      projectedSamples = field.samples.map((sample) => {
        const point = map.project([sample.longitude, sample.latitude]);
        return {
          x: point.x * pixelRatio,
          y: point.y * pixelRatio,
          sample,
        };
      });
      particles = Array.from({ length: PARTICLE_COUNT }, () =>
        createParticle(
          width * pixelRatio,
          height * pixelRatio,
          projectedSamples,
        ),
      );
    };

    const animate = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const segmentData = new Float32Array(PARTICLE_COUNT * 24);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const wind = interpolateWind(
          particle.x,
          particle.y,
          projectedSamples,
        );
        particle.east = wind?.east ?? 0;
        particle.north = wind?.north ?? 0;
        particle.speed = wind?.speed ?? 0;
        particle.previousX = particle.x;
        particle.previousY = particle.y;
        particle.x += particle.east * 0.035 * pixelRatio;
        particle.y -= particle.north * 0.035 * pixelRatio;
        particle.life += 1;

        if (
          particle.life > particle.maxLife ||
          particle.x < 0 ||
          particle.x > canvas.width ||
          particle.y < 0 ||
          particle.y > canvas.height
        ) {
          particles[index] = createParticle(
            canvas.width,
            canvas.height,
            projectedSamples,
          );
          particles[index].life = 0;
          continue;
        }

        const opacity = Math.min(
          particle.life / PARTICLE_FADE_IN,
          (particle.maxLife - particle.life) / PARTICLE_FADE_OUT,
          0.78,
        );
        const deltaX = particle.x - particle.previousX;
        const deltaY = particle.y - particle.previousY;
        const distance = Math.hypot(deltaX, deltaY);

        let tailX = particle.previousX;
        let tailY = particle.previousY;
        if (distance > 0) {
          const tailLength = Math.min(
            30 * PARTICLE_SIZE_FACTOR * pixelRatio,
            Math.max(
              7 * PARTICLE_SIZE_FACTOR * pixelRatio,
              distance * PARTICLE_LENGTH_MULTIPLIER,
            ),
          );
          tailX = particle.x - (deltaX / distance) * tailLength;
          tailY = particle.y - (deltaY / distance) * tailLength;
        }

        let normalX = 0;
        let normalY = 0;
        if (distance > 0) {
          normalX = -deltaY / distance;
          normalY = deltaX / distance;
        }
        const halfWidth =
          (0.8 + (Math.min(particle.speed, 60) / 60) * 1.2) *
          PARTICLE_SIZE_FACTOR *
          pixelRatio;

        const tailAlpha = opacity * 0.12;
        const offset = index * 24;
        const tailLeftX = tailX + normalX * halfWidth;
        const tailLeftY = tailY + normalY * halfWidth;
        const tailRightX = tailX - normalX * halfWidth;
        const tailRightY = tailY - normalY * halfWidth;
        const headLeftX = particle.x + normalX * halfWidth;
        const headLeftY = particle.y + normalY * halfWidth;
        const headRightX = particle.x - normalX * halfWidth;
        const headRightY = particle.y - normalY * halfWidth;

        segmentData[offset] = tailLeftX;
        segmentData[offset + 1] = tailLeftY;
        segmentData[offset + 2] = particle.speed;
        segmentData[offset + 3] = tailAlpha;
        segmentData[offset + 4] = tailRightX;
        segmentData[offset + 5] = tailRightY;
        segmentData[offset + 6] = particle.speed;
        segmentData[offset + 7] = tailAlpha;
        segmentData[offset + 8] = headLeftX;
        segmentData[offset + 9] = headLeftY;
        segmentData[offset + 10] = particle.speed;
        segmentData[offset + 11] = opacity;
        segmentData[offset + 12] = tailRightX;
        segmentData[offset + 13] = tailRightY;
        segmentData[offset + 14] = particle.speed;
        segmentData[offset + 15] = tailAlpha;
        segmentData[offset + 16] = headRightX;
        segmentData[offset + 17] = headRightY;
        segmentData[offset + 18] = particle.speed;
        segmentData[offset + 19] = opacity;
        segmentData[offset + 20] = headLeftX;
        segmentData[offset + 21] = headLeftY;
        segmentData[offset + 22] = particle.speed;
        segmentData[offset + 23] = opacity;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, segmentData, gl.DYNAMIC_DRAW);

      gl.enableVertexAttribArray(positionLocation);
      gl.enableVertexAttribArray(alphaLocation);
      gl.enableVertexAttribArray(speedLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(alphaLocation, 1, gl.FLOAT, false, 16, 12);
      gl.vertexAttribPointer(speedLocation, 1, gl.FLOAT, false, 16, 8);

      gl.drawArrays(gl.TRIANGLES, 0, PARTICLE_COUNT * 6);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const onMapMove = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      projectedSamples = field.samples.map((sample) => {
        const point = map.project([sample.longitude, sample.latitude]);
        return {
          x: point.x * pixelRatio,
          y: point.y * pixelRatio,
          sample,
        };
      });
    };

    resize();
    map.on("move", onMapMove);
    map.on("resize", resize);
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      map.off("move", onMapMove);
      map.off("resize", resize);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [darkMode, field, isPlaying, map]);

  return (
    <canvas aria-hidden="true" className="wind-particles" ref={canvasRef} />
  );
}
