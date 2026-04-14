"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

// ─── GLSL noise helpers (shared) ─────────────────────────────────────────────
const PERLIN_NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+10.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

  float pnoise(vec3 P, vec3 rep) {
    vec3 Pi0 = mod(floor(P), rep);
    vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
    Pi0 = mod289(Pi0);
    Pi1 = mod289(Pi1);
    vec3 Pf0 = fract(P);
    vec3 Pf1 = Pf0 - vec3(1.0);
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = Pi0.zzzz;
    vec4 iz1 = Pi1.zzzz;
    vec4 ixy  = permute(permute(ix) + iy);
    vec4 ixy0 = permute(ixy + iz0);
    vec4 ixy1 = permute(ixy + iz1);
    vec4 gx0 = ixy0 * (1.0 / 7.0);
    vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
    gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5);
    gy0 -= sz0 * (step(0.0, gy0) - 0.5);
    vec4 gx1 = ixy1 * (1.0 / 7.0);
    vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
    gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5);
    gy1 -= sz1 * (step(0.0, gy1) - 0.5);
    vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
    vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
    vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
    vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
    vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
    vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
    vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
    vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
    vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000), dot(g010,g010), dot(g100,g100), dot(g110,g110)));
    g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
    vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001), dot(g011,g011), dot(g101,g101), dot(g111,g111)));
    g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
    float n000 = dot(g000, Pf0);
    float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
    float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
    float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
    float n111 = dot(g111, Pf1);
    vec3 fade_xyz = fade(Pf0);
    vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
    float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
    return 2.2 * n_xyz;
  }
`;

const SIMPLEX_NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x*34.0)+10.0)*x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
`;

// ─── Wireframe sphere (outer, with noise displacement) ───────────────────────
const wireframeVertexShader = /* glsl */ `
  uniform float u_time;
  uniform float u_frequency;
  uniform float u_speaking;
  uniform float u_audioLevel;
  uniform float u_pulseEffect;
  ${PERLIN_NOISE_GLSL}

  void main() {
    float timeMultiplier = 1.0 + u_speaking * 2.5 + (u_audioLevel / 200.0);
    float noise1 = pnoise(position * 0.8 + u_time * timeMultiplier * 0.3, vec3(10.0));
    float noise2 = pnoise(position * 1.2 + u_time * timeMultiplier * 0.5, vec3(8.0)) * 0.5;
    float combinedNoise = (noise1 + noise2) * 1.2;
    float pulse = sin(u_time * 3.0) * 0.08 * u_pulseEffect;
    float baseDisplacement = (u_frequency / 50.0) * (combinedNoise / 10.0);
    float voiceDisplacement = u_speaking * 0.5 + (u_audioLevel / 150.0) * 0.1;
    float displacement = baseDisplacement + voiceDisplacement + pulse;
    vec3 newPosition = position + normal * displacement;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`;

const wireframeFragmentShader = /* glsl */ `
  uniform float u_red;
  uniform float u_green;
  uniform float u_blue;

  void main() {
    vec3 finalColor = vec3(u_red, u_green, u_blue);
    gl_FragColor = vec4(finalColor, 0.8);
  }
`;

// ─── Inner bubble sphere (fresnel effect) ────────────────────────────────────
const bubbleVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 0.90);
  }
`;

const bubbleFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSpeaking;
  uniform float uAudioLevel;

  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec2 vUv;

  void main() {
    vec3 viewDirection = normalize(-vPosition);
    float fresnel = 1.0 - dot(viewDirection, vNormal);
    fresnel = pow(fresnel, 2.0);

    // Purple-tinted bubble base
    vec3 bubbleColor = vec3(0.08, 0.01, 0.15);

    // Subtle iridescence
    float iridescence = sin(vUv.x * 10.0 + uTime * 2.0) * 0.1;
    bubbleColor.r += iridescence * 0.8;
    bubbleColor.g += iridescence * 0.2;
    bubbleColor.b += iridescence;

    // Respond to speaking with brighter purple
    if (uSpeaking > 0.1) {
      bubbleColor = mix(bubbleColor, vec3(0.3, 0.05, 0.5), uSpeaking * 0.3);
    } else if (uAudioLevel > 15.0) {
      float audioIntensity = min(uAudioLevel / 100.0, 0.5);
      bubbleColor = mix(bubbleColor, vec3(0.5, 0.2, 0.8), audioIntensity * 0.2);
    }

    float finalOpacity = uOpacity + fresnel * 0.2;
    float breathe = sin(uTime * 1.2) * 0.02 + 0.70;
    finalOpacity *= breathe;

    gl_FragColor = vec4(bubbleColor, finalOpacity);
  }
`;

// ─── Particle system (sparkle points) ────────────────────────────────────────
const particleVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uSpeaking;
  uniform float uAudioLevel;
  attribute vec3 originalPosition;
  ${SIMPLEX_NOISE_GLSL}

  void main() {
    vec3 pos = originalPosition;
    float timeScale = uTime / 8.0;
    float noiseX = snoise(pos * 2.0 + vec3(timeScale, 0.0, 0.0));
    float noiseY = snoise(pos * 2.0 + vec3(0.0, timeScale, 0.0));
    float noiseZ = snoise(pos * 2.0 + vec3(0.0, 0.0, timeScale));
    vec3 oscillation = vec3(noiseX, noiseY, noiseZ) * 0.8;
    float activityMultiplier = 1.0 + uSpeaking * 0.5 + (uAudioLevel / 200.0);
    oscillation *= activityMultiplier;
    pos += oscillation;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 3.0;
  }
`;

const particleFragmentShader = /* glsl */ `
  uniform float uSpeaking;
  uniform float uAudioLevel;

  void main() {
    vec3 baseColor = vec3(0.85, 0.75, 1.0);
    vec3 finalColor = baseColor;
    if (uSpeaking > 0.1) {
      finalColor = mix(baseColor, vec3(1.0, 0.8, 1.0), uSpeaking * 0.3);
    } else if (uAudioLevel > 15.0) {
      float audioIntensity = min(uAudioLevel / 100.0, 0.5);
      finalColor = mix(baseColor, vec3(0.8, 0.7, 1.0), audioIntensity);
    }
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    if (dist > 0.5) discard;
    float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
    gl_FragColor = vec4(finalColor, alpha * 0.8);
  }
`;

// ─── Full-screen gradient background ─────────────────────────────────────────
const bgVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const bgFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec3 uColorTopLeft;
  uniform vec3 uColorTopRight;
  uniform vec3 uColorBottomLeft;
  uniform vec3 uColorBottomRight;

  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.0, 289.0))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
    vec2 u = f*f*(3.0-2.0*f);
    return mix(a, b, u.x) + (c - a)*u.y*(1.0-u.x) + (d - b)*u.x*u.y;
  }

  void main() {
    vec2 uv = vUv;

    vec3 topMix    = mix(uColorTopLeft,    uColorTopRight,    uv.x);
    vec3 bottomMix = mix(uColorBottomLeft, uColorBottomRight, uv.x);
    vec3 finalColor = mix(bottomMix, topMix, uv.y);

    // Mouse-follow halo
    float dist = distance(uv, uMouse);
    float halo = smoothstep(0.8, 0.0, dist);
    finalColor += halo * 0.03;

    // Subtle noise texture
    finalColor += 0.008 * noise(uv * 15.0 + uTime * 0.03);

    // Gentle breathing
    float breathe = sin(uTime * 0.6) * 0.015 + 0.985;
    finalColor *= breathe;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

// ─── Component ───────────────────────────────────────────────────────────────
interface SphereSceneProps {
  isSpeaking?: boolean;
  audioLevel?: number;
}

export default function SphereScene({ isSpeaking = false, audioLevel = 0 }: SphereSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasOverlayRef = useRef<HTMLCanvasElement>(null);
  const speakingRef = useRef(isSpeaking);
  const audioLevelRef = useRef(audioLevel);

  // Keep refs in sync with props
  useEffect(() => { speakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { audioLevelRef.current = audioLevel; }, [audioLevel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const w = container.clientWidth;
    const h = container.clientHeight;

    // Overlay canvas size
    const overlay = canvasOverlayRef.current;
    if (overlay) {
      overlay.width = w;
      overlay.height = h;
    }

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.classList.add("webgl");
    renderer.domElement.style.position = "absolute";
    renderer.domElement.style.top = "0";
    renderer.domElement.style.left = "0";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    // ── Scene & Camera ──
    const scene = new THREE.Scene();

    // Pull the camera back on portrait screens so the sphere never clips horizontally.
    // Sphere radius is ~4 units; camera vFOV=33°. On narrow aspect ratios the horizontal
    // FOV shrinks and the sphere clips. We compute the minimum z that keeps it inside.
    const SPHERE_RADIUS = 4;
    const V_FOV_RAD = THREE.MathUtils.degToRad(33);
    const SPHERE_MARGIN = 1.35; // 35% breathing room around the sphere
    const computeCameraZ = (aspect: number) => {
      const hFOVHalf = Math.atan(Math.tan(V_FOV_RAD / 2) * aspect);
      return Math.max(20, (SPHERE_RADIUS * SPHERE_MARGIN) / Math.tan(hFOVHalf));
    };

    const camera = new THREE.PerspectiveCamera(33, w / h, 0.1, 1000);
    camera.position.set(0, -2, computeCameraZ(w / h));
    camera.lookAt(0, 0, 0);

    // ── Background (fullscreen quad via ShaderPass) ──
    const bgUniforms = {
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uResolution: { value: new THREE.Vector2(w, h) },
      // Purple gradient corners
      uColorTopLeft: { value: new THREE.Color(0.25, 0.08, 0.35) },
      uColorTopRight: { value: new THREE.Color(0.35, 0.05, 0.30) },
      uColorBottomLeft: { value: new THREE.Color(0.15, 0.05, 0.25) },
      uColorBottomRight: { value: new THREE.Color(0.20, 0.03, 0.20) },
    };

    // ── 1. Wireframe sphere ──
    const wireframeUniforms = {
      u_time: { value: 0 },
      u_frequency: { value: 0 },
      u_red: { value: 0.15 },
      u_green: { value: 0.05 },
      u_blue: { value: 0.25 },
      u_speaking: { value: 0 },
      u_audioLevel: { value: 0 },
      u_pulseEffect: { value: 0 },
    };

    const wireframeMat = new THREE.ShaderMaterial({
      uniforms: wireframeUniforms,
      vertexShader: wireframeVertexShader,
      fragmentShader: wireframeFragmentShader,
      wireframe: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
    });

    const wireframeGeo = new THREE.IcosahedronGeometry(4, 32);
    const wireframeMesh = new THREE.Mesh(wireframeGeo, wireframeMat);
    scene.add(wireframeMesh);

    // ── 2. Inner bubble sphere ──
    const bubbleUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: 0.15 },
      uSpeaking: { value: 0 },
      uAudioLevel: { value: 0 },
    };

    const bubbleMat = new THREE.ShaderMaterial({
      uniforms: bubbleUniforms,
      vertexShader: bubbleVertexShader,
      fragmentShader: bubbleFragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const bubbleGeo = new THREE.IcosahedronGeometry(3, 32);
    const bubbleMesh = new THREE.Mesh(bubbleGeo, bubbleMat);
    scene.add(bubbleMesh);

    // ── 3. Particle system ──
    const PARTICLE_COUNT = 1000;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const originals = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = Math.random() * 3.2;
      const phi = Math.random() * Math.PI * 2;
      const theta = Math.acos(Math.random() * 2 - 1);
      const x = r * Math.sin(theta) * Math.cos(phi);
      const y = r * Math.sin(theta) * Math.sin(phi);
      const z = r * Math.cos(theta);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      originals[i * 3] = x;
      originals[i * 3 + 1] = y;
      originals[i * 3 + 2] = z;
    }

    particleGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    particleGeo.setAttribute("originalPosition", new THREE.BufferAttribute(originals, 3));

    const particleUniforms = {
      uTime: { value: 0 },
      uSpeaking: { value: 0 },
      uAudioLevel: { value: 0 },
    };

    const particleMat = new THREE.ShaderMaterial({
      uniforms: particleUniforms,
      vertexShader: particleVertexShader,
      fragmentShader: particleFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // ── Post-processing ──
    const bgPass = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: bgUniforms,
        vertexShader: bgVertexShader,
        fragmentShader: bgFragmentShader,
      })
    );
    bgPass.renderToScreen = false;

    const renderPass = new RenderPass(scene, camera);
    renderPass.clear = false;
    renderPass.clearDepth = true;

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.8,  // strength
      0.3,  // radius
      0.15  // threshold
    );
    bloomPass.renderToScreen = true;

    const composer = new EffectComposer(renderer);
    composer.addPass(bgPass);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

    // ── 2D overlay canvas for aura glow ──
    const overlayCtx = overlay?.getContext("2d") ?? null;
    type AuraParticle = { x: number; y: number; alpha: number; size: number; life: number };
    let auraParticles: AuraParticle[] = [];

    const drawAura = () => {
      if (!overlayCtx || !overlay) return;
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      auraParticles = auraParticles.filter((p) => p.alpha > 0.005 && p.life < 1);
      for (const p of auraParticles) {
        overlayCtx.save();
        overlayCtx.globalAlpha = p.alpha * 0.7;
        const grad = overlayCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, "rgba(80, 20, 120, 0.2)");
        grad.addColorStop(0.2, "rgba(100, 30, 150, 0.15)");
        grad.addColorStop(0.5, "rgba(60, 10, 100, 0.08)");
        grad.addColorStop(0.8, "rgba(80, 20, 120, 0.04)");
        grad.addColorStop(1, "rgba(120, 80, 160, 0.008)");
        overlayCtx.beginPath();
        overlayCtx.arc(p.x, p.y, p.size, 0, 2 * Math.PI);
        overlayCtx.fillStyle = grad;
        overlayCtx.fill();
        overlayCtx.restore();
        p.alpha *= 0.96;
        p.size *= 1.015;
        p.life += 0.016;
      }
    };

    const spawnAura = () => {
      if (!container) return;
      const cx = container.clientWidth / 2;
      const cy = container.clientHeight / 2;
      if (Math.random() > 0.92) {
        auraParticles.push({
          x: cx + (Math.random() - 0.5) * 250,
          y: cy + (Math.random() - 0.5) * 250,
          alpha: 0.15,
          size: 12,
          life: 0,
        });
      }
    };

    // ── Mouse tracking ──
    let mouseX = 0;
    let mouseY = 0;
    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      mouseX = (mx - w / 2) / 100;
      mouseY = (my - h / 2) / 100;
      bgUniforms.uMouse.value.set(mx / w, 1 - my / h);
    };
    document.addEventListener("mousemove", onMouseMove);

    // ── Resize ──
    const onResize = () => {
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.position.setZ(computeCameraZ(nw / nh));
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
      composer.setSize(nw, nh);
      bgUniforms.uResolution.value.set(nw, nh);
      if (overlay) {
        overlay.width = nw;
        overlay.height = nh;
      }
    };
    window.addEventListener("resize", onResize);

    // ── Animation loop ──
    const clock = new THREE.Clock();
    let frameId: number;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const animate = () => {
      frameId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();
      const dt = clock.getDelta();

      // Background
      bgUniforms.uTime.value = elapsed;

      // Wireframe
      wireframeUniforms.u_time.value = elapsed;
      const speakingVal = speakingRef.current ? 1.0 : 0.0;
      const audioVal = audioLevelRef.current;
      const idleFreq = 5 + Math.sin(elapsed * 0.5) * 9;
      const speakingFreq = idleFreq + audioVal * 0.5;
      wireframeUniforms.u_frequency.value = speakingFreq;
      wireframeUniforms.u_speaking.value = lerp(wireframeUniforms.u_speaking.value, speakingVal, dt * 5);
      wireframeUniforms.u_audioLevel.value = lerp(wireframeUniforms.u_audioLevel.value, audioVal, dt * 8);
      wireframeUniforms.u_pulseEffect.value = lerp(wireframeUniforms.u_pulseEffect.value, speakingVal, dt * 3);

      // Color shimmer
      const shimmer = Math.sin(elapsed * 1.5) * 0.03 + 0.97;
      const targetR = speakingVal > 0.5 ? 0.25 : 0.15;
      const targetG = speakingVal > 0.5 ? 0.08 : 0.05;
      const targetB = speakingVal > 0.5 ? 0.45 : 0.25;
      wireframeUniforms.u_red.value = lerp(wireframeUniforms.u_red.value, targetR * shimmer, dt * 2);
      wireframeUniforms.u_green.value = lerp(wireframeUniforms.u_green.value, targetG * shimmer, dt * 2);
      wireframeUniforms.u_blue.value = lerp(wireframeUniforms.u_blue.value, targetB * shimmer, dt * 2);

      // Bubble
      bubbleUniforms.uTime.value = elapsed;
      bubbleUniforms.uOpacity.value = 0.15 + speakingVal * 0.08;
      bubbleUniforms.uSpeaking.value = lerp(bubbleUniforms.uSpeaking.value, speakingVal, dt * 5);
      bubbleUniforms.uAudioLevel.value = lerp(bubbleUniforms.uAudioLevel.value, audioVal, dt * 8);

      // Bubble slow rotation
      const rotSpeed = 1.0 + speakingVal * 1.5;
      bubbleMesh.rotation.x += 0.001 * rotSpeed;
      bubbleMesh.rotation.y += 0.002 * rotSpeed;
      bubbleMesh.rotation.z += 0.0005 * rotSpeed;

      // Particles
      particleUniforms.uTime.value = elapsed;
      particleUniforms.uSpeaking.value = lerp(particleUniforms.uSpeaking.value, speakingVal, dt * 5);
      particleUniforms.uAudioLevel.value = lerp(particleUniforms.uAudioLevel.value, audioVal, dt * 8);

      // Bloom intensity reacts to voice
      bloomPass.strength = 0.8 + speakingVal * 0.4 + (audioVal / 200.0) * 0.3;

      // Camera follow mouse
      camera.position.x += (mouseX - camera.position.x) * 0.05;
      camera.position.y += (-mouseY - camera.position.y) * 0.05;
      camera.lookAt(scene.position);

      // Overlay effects
      spawnAura();
      drawAura();

      composer.render();
    };

    animate();

    // ── Cleanup ──
    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      wireframeGeo.dispose();
      wireframeMat.dispose();
      bubbleGeo.dispose();
      bubbleMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        overflow: "hidden",
        width: "100dvw",
        height: "100dvh",
      }}
    >
      <canvas
        ref={canvasOverlayRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 2,
          mixBlendMode: "normal",
          opacity: 1,
        }}
      />
    </div>
  );
}
