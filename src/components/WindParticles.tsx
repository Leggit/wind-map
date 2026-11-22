import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { interpolateWind, type WindField } from "../data/wind";
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

interface ParticleSettings {
  count: number;
  sizeFactor: number;
}

const PARTICLE_MIN_LIFETIME = 480;
const PARTICLE_LIFETIME_VARIATION = 360;
const PARTICLE_FADE_IN = 24;
const PARTICLE_FADE_OUT = 60;
const WIND_DIRECTION_PROJECTION_STEP = 0.0001;

function getParticleSettings(screenWidth: number): ParticleSettings {
  if (screenWidth <= 760) {
    return { count: 350, sizeFactor: 0.3 };
  }
  if (screenWidth <= 1023) {
    return { count: 450, sizeFactor: 0.4 };
  }
  if (screenWidth < 1920) {
    return { count: 600, sizeFactor: 0.4 };
  }
  return { count: 900, sizeFactor: 0.4 };
}

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
    if (speed <= 15.0) return vec3(0.027, 0.349, 0.522);
    if (speed <= 30.0) return vec3(0.145, 0.388, 0.922);
    if (speed <= 45.0) return vec3(0.427, 0.157, 0.851);
    if (speed <= 60.0) return vec3(0.753, 0.149, 0.827);
    return vec3(0.761, 0.255, 0.047);
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

function createParticle(
  width: number,
  height: number,
  samples: WindField["samples"],
  map: MapLibreMap,
  pixelRatio: number,
  x = Math.random() * width,
  y = Math.random() * height,
): Particle {
  const point = map.unproject([x / pixelRatio, y / pixelRatio]);
  const wind = interpolateWind(samples, point.lat, point.lng);
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
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map || !field) {
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

    let particles: Particle[] = [];
    let segmentData = new Float32Array(0);
    let particleCount = 0;
    let particleSizeFactor = 0.4;
    let animationFrame = 0;

    const getMapSize = () => ({
      width: map.getCanvas().clientWidth,
      height: map.getCanvas().clientHeight,
    });

    const updateHorizonMask = () => {
      const pitch = map.getPitch();
      if (pitch <= 0) {
        canvas.style.clipPath = "";
        return;
      }

      const { height } = getMapSize();
      const fieldOfView = (map.getVerticalFieldOfView() * Math.PI) / 180;
      const cameraDistance = height / (2 * Math.tan(fieldOfView / 2));
      const horizonY =
        height / 2 -
        cameraDistance * Math.tan(((90 - pitch) * Math.PI) / 180);

      canvas.style.clipPath =
        horizonY > 0 ? `inset(${Math.min(horizonY, height)}px 0 0)` : "";
    };

    const resize = () => {
      const { width, height } = getMapSize();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const particleSettings = getParticleSettings(window.innerWidth);
      console.log(particleSettings);
      particleCount = particleSettings.count;
      particleSizeFactor = particleSettings.sizeFactor;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);

      particles = Array.from({ length: particleCount }, () =>
        createParticle(
          width * pixelRatio,
          height * pixelRatio,
          field.samples,
          map,
          pixelRatio,
        ),
      );
      segmentData = new Float32Array(particles.length * 24);
      updateHorizonMask();
    };

    const animate = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const bearing = (map.getBearing() * Math.PI) / 180;
      const bearingCosine = Math.cos(bearing);
      const bearingSine = Math.sin(bearing);
      const densityCellSize = 64 * pixelRatio;
      const densityColumns = Math.max(
        1,
        Math.ceil(canvas.width / densityCellSize),
      );
      const densityRows = Math.max(
        1,
        Math.ceil(canvas.height / densityCellSize),
      );
      const densityGrid = new Uint16Array(densityColumns * densityRows);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      for (let index = 0; index < particles.length; index += 1) {
        let particle = particles[index];
        if (isPlayingRef.current) {
          const point = map.unproject([
            particle.x / pixelRatio,
            particle.y / pixelRatio,
          ]);
          const wind = interpolateWind(field.samples, point.lat, point.lng);
          particle.east = wind?.east ?? 0;
          particle.north = wind?.north ?? 0;
          particle.speed = wind?.speed ?? 0;
          particle.previousX = particle.x;
          particle.previousY = particle.y;
          let movementX =
            particle.east * bearingCosine - particle.north * bearingSine;
          let movementY = -(
            particle.east * bearingSine +
            particle.north * bearingCosine
          );

          if (map.getPitch() > 0) {
            const point = map.unproject([
              particle.x / pixelRatio,
              particle.y / pixelRatio,
            ]);
            const latitude = Math.max(-85, Math.min(85, point.lat));
            const longitudeOffset =
              (particle.east * WIND_DIRECTION_PROJECTION_STEP) /
              Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
            const projectedWind = map.project([
              point.lng + longitudeOffset,
              Math.max(
                -85,
                Math.min(
                  85,
                  latitude + particle.north * WIND_DIRECTION_PROJECTION_STEP,
                ),
              ),
            ]);
            const projectedX = projectedWind.x - particle.x / pixelRatio;
            const projectedY = projectedWind.y - particle.y / pixelRatio;
            const projectedLength = Math.hypot(projectedX, projectedY);
            if (projectedLength > 0) {
              movementX = (projectedX / projectedLength) * particle.speed;
              movementY = (projectedY / projectedLength) * particle.speed;
            }
          }

          particle.x += movementX * 0.035 * pixelRatio;
          particle.y += movementY * 0.035 * pixelRatio;
          particle.life += 1;

          if (
            particle.life > particle.maxLife ||
            particle.x < 0 ||
            particle.x > canvas.width ||
            particle.y < 0 ||
            particle.y > canvas.height
          ) {
            particle = createParticle(
              canvas.width,
              canvas.height,
              field.samples,
              map,
              pixelRatio,
            );
            particle.life = 0;
            particles[index] = particle;
          }
        }

        const cellX = Math.min(
          densityColumns - 1,
          Math.floor(particle.x / densityCellSize),
        );
        const cellY = Math.min(
          densityRows - 1,
          Math.floor(particle.y / densityCellSize),
        );
        densityGrid[cellY * densityColumns + cellX] += 1;
      }

      const averageDensity = particles.length / densityGrid.length;
      const maximumCellDensity = averageDensity * 1.5;
      const maximumRedistributions = Math.max(
        1,
        Math.floor(particles.length * 0.002),
      );
      let redistributedCount = 0;
      for (
        let sourceCell = 0;
        sourceCell < densityGrid.length &&
        redistributedCount < maximumRedistributions;
        sourceCell += 1
      ) {
        let particlesToMove = Math.min(
          Math.ceil(densityGrid[sourceCell] - maximumCellDensity),
          maximumRedistributions - redistributedCount,
        );
        if (particlesToMove <= 0) {
          continue;
        }

        for (
          let particleIndex = particles.length - 1;
          particleIndex >= 0 && particlesToMove > 0;
          particleIndex -= 1
        ) {
          const particle = particles[particleIndex];
          const particleCellX = Math.min(
            densityColumns - 1,
            Math.floor(particle.x / densityCellSize),
          );
          const particleCellY = Math.min(
            densityRows - 1,
            Math.floor(particle.y / densityCellSize),
          );
          if (particleCellY * densityColumns + particleCellX !== sourceCell) {
            continue;
          }

          let leastPopulation = Number.POSITIVE_INFINITY;
          const destinationCells: number[] = [];
          for (
            let destinationCell = 0;
            destinationCell < densityGrid.length;
            destinationCell += 1
          ) {
            const population = densityGrid[destinationCell];
            if (
              destinationCell === sourceCell ||
              population >= averageDensity * 1.25
            ) {
              continue;
            }
            if (population < leastPopulation) {
              leastPopulation = population;
              destinationCells.length = 0;
              destinationCells.push(destinationCell);
            } else if (population === leastPopulation) {
              destinationCells.push(destinationCell);
            }
          }
          if (destinationCells.length === 0) {
            break;
          }

          const destinationCell =
            destinationCells[
              Math.floor(Math.random() * destinationCells.length)
            ];
          const destinationColumn = destinationCell % densityColumns;
          const destinationRow = Math.floor(destinationCell / densityColumns);
          const destinationX =
            destinationColumn * densityCellSize +
            Math.random() *
              Math.min(
                densityCellSize,
                canvas.width - destinationColumn * densityCellSize,
              );
          const destinationY =
            destinationRow * densityCellSize +
            Math.random() *
              Math.min(
                densityCellSize,
                canvas.height - destinationRow * densityCellSize,
              );
          const respawnedParticle = createParticle(
            canvas.width,
            canvas.height,
            field.samples,
            map,
            pixelRatio,
            destinationX,
            destinationY,
          );
          respawnedParticle.life = 0;
          particles[particleIndex] = respawnedParticle;
          densityGrid[sourceCell] -= 1;
          densityGrid[destinationCell] += 1;
          particlesToMove -= 1;
          redistributedCount += 1;
        }
      }

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const cellX = Math.min(
          densityColumns - 1,
          Math.floor(particle.x / densityCellSize),
        );
        const cellY = Math.min(
          densityRows - 1,
          Math.floor(particle.y / densityCellSize),
        );
        let nearbyCount = 0;
        let nearbyCells = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const neighborY = cellY + offsetY;
          if (neighborY < 0 || neighborY >= densityRows) {
            continue;
          }
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const neighborX = cellX + offsetX;
            if (neighborX < 0 || neighborX >= densityColumns) {
              continue;
            }
            nearbyCount += densityGrid[neighborY * densityColumns + neighborX];
            nearbyCells += 1;
          }
        }
        const localDensity = nearbyCount / nearbyCells;
        const densityOpacity = Math.max(
          darkMode ? 0.45 : 0.55,
          Math.min(averageDensity / localDensity, 1),
        );
        const lifetimeOpacity = Math.min(
          particle.life / PARTICLE_FADE_IN,
          (particle.maxLife - particle.life) / PARTICLE_FADE_OUT,
          0.9,
        );
        const opacity = lifetimeOpacity * densityOpacity;
        const deltaX = particle.x - particle.previousX;
        const deltaY = particle.y - particle.previousY;
        const distance = Math.hypot(deltaX, deltaY);

        let tailX = particle.previousX;
        let tailY = particle.previousY;
        if (distance > 0) {
          const tailLength =
            (darkMode ? 24 : 30) * particleSizeFactor * pixelRatio;
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
          (darkMode ? 2.1 : 3.1) * particleSizeFactor * pixelRatio;

        const tailAlpha = opacity * (darkMode ? 0.15 : 0.35);
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

      gl.drawArrays(gl.TRIANGLES, 0, particles.length * 6);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const onMapMove = () => {
      updateHorizonMask();
    };
    const resetParticles = () => {
      const { width, height } = getMapSize();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      particles = Array.from({ length: particleCount }, () =>
        createParticle(
          width * pixelRatio,
          height * pixelRatio,
          field.samples,
          map,
          pixelRatio,
        ),
      );
      segmentData.fill(0);
    };

    resize();
    map.on("move", onMapMove);
    map.on("moveend", resetParticles);
    map.on("resize", resize);
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      map.off("move", onMapMove);
      map.off("moveend", resetParticles);
      map.off("resize", resize);
      canvas.style.clipPath = "";
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [darkMode, field, map]);

  return (
    <canvas aria-hidden="true" className="wind-particles" ref={canvasRef} />
  );
}
