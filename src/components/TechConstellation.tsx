"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";

/* ─── Tech stack: logo path + 3D position + brand color ─── */
const TECHS = [
  { label: "Docker",      icon: "/icons/docker.svg",      color: [36,150,237],  x: 0.15, y: 0.42, z: 0.3  },  // #2496ED
  { label: "Kubernetes",  icon: "/icons/kubernetes.svg",  color: [50,108,229],  x:-0.6,  y: 0.25, z:-0.2  },  // #326CE5
  { label: "Kafka",       icon: "/icons/kafka.svg",       color: [200,200,210], x: 0.55, y: 0.30, z: 0.1  },  // light grey
  { label: "Spring Boot", icon: "/icons/springboot.svg",  color: [109,179,63],  x:-0.2,  y: -0.05, z: 0.4  },  // #6DB33F
  { label: "Redis",       icon: "/icons/redis.svg",       color: [220,56,45],   x:-0.65, y:-0.35, z:-0.1  },  // #DC382D
  { label: "PostgreSQL",  icon: "/icons/postgresql.svg",  color: [51,103,145],  x: 0.35, y:-0.30, z: 0.25 },  // #336791
  { label: "AWS",         icon: "/icons/aws.svg",         color: [255,153,0],   x:-0.35, y:-0.70, z: 0.15 },  // #FF9900
];



/* ─── Create a radial glow canvas — inner (tight, bright) ─── */
function makeGlowTexture(r: number, g: number, b: number): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  const h = s / 2;
  const grad = ctx.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0,    `rgba(${r},${g},${b},0.9)`);
  grad.addColorStop(0.25, `rgba(${r},${g},${b},0.45)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.12)`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/* ─── Create a radial glow canvas — outer (wide, soft bloom) ─── */
function makeBloomTexture(r: number, g: number, b: number): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  const h = s / 2;
  const grad = ctx.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0,    `rgba(${r},${g},${b},0.4)`);
  grad.addColorStop(0.3,  `rgba(${r},${g},${b},0.15)`);
  grad.addColorStop(0.65, `rgba(${r},${g},${b},0.04)`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

/* ─── Load an SVG from a URL and return a THREE texture ─── */
function loadIconTexture(url: string): Promise<THREE.CanvasTexture> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;   
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.premultiplyAlpha = false;
      resolve(tex);
    };
    img.onerror = () => {
      // fallback: blank texture
      const canvas = document.createElement("canvas");
      canvas.width = 4;
      canvas.height = 4;
      resolve(new THREE.CanvasTexture(canvas));
    };
    img.src = url;
  });
}

/* ─── Main Component ─── */
export default function TechConstellation() {
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const cleanupRef = useRef<(() => void) | null>(null);


  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    (async () => {
      /* ─── Load all icon textures ─── */
      const textures = await Promise.all(TECHS.map((t) => loadIconTexture(t.icon)));
      if (cancelled) return;

      /* ─── Scene ─── */
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        45,
        container.clientWidth / container.clientHeight,
        0.1,
        100
      );
      camera.position.set(0, 0, 3.5);

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;
      container.appendChild(renderer.domElement);

      /* ─── Cinematic 3-point lighting ─── */
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));

      // Key light — warm orange, follows mouse
      const warmLight = new THREE.PointLight(new THREE.Color("#FBBA27"), 3, 12);
      warmLight.position.set(1.5, 1.5, 3);
      scene.add(warmLight);

      // Fill light — cool teal
      const coolLight = new THREE.PointLight(new THREE.Color("#5EEAD4"), 1.5, 12);
      coolLight.position.set(-2.5, -1, 2.5);
      scene.add(coolLight);

      // Rim / accent light — soft magenta for depth
      const rimLight = new THREE.PointLight(new THREE.Color("#C084FC"), 1.2, 10);
      rimLight.position.set(0, -2, -1);
      scene.add(rimLight);

      const clock = new THREE.Clock();
      const SCALE = 1.3;
      const basePositions: THREE.Vector3[] = [];
      const sprites: THREE.Sprite[] = [];

      const glowSprites: THREE.Sprite[] = [];
      const bloomSprites: THREE.Sprite[] = [];

      /* ─── Create logo sprites with dual-layer colored glows ─── */
      TECHS.forEach((tech, i) => {
        const basePos = new THREE.Vector3(
          tech.x * SCALE,
          tech.y * SCALE,
          tech.z * 0.5
        );
        basePositions.push(basePos.clone());

        const [cr, cg, cb] = tech.color;

        // // Layer 1: wide outer bloom (large, soft)
        // const bloomMat = new THREE.SpriteMaterial({
        //   map: makeBloomTexture(cr, cg, cb),
        //   transparent: true,
        //   opacity: 0.7,
        //   depthWrite: false,
        //   blending: THREE.AdditiveBlending,
        // });
        // const bloom = new THREE.Sprite(bloomMat);
        // bloom.scale.set(1.4, 1.4, 1);
        // bloom.position.copy(basePos);
        // bloom.renderOrder = 0;
        // scene.add(bloom);
        // bloomSprites.push(bloom);

        // Layer 2: tight inner glow
        // const glowMat = new THREE.SpriteMaterial({
        //   map: makeGlowTexture(cr, cg, cb),
        //   transparent: true,
        //   opacity: 0.85,
        //   depthWrite: false,
        //   blending: THREE.AdditiveBlending,
        // });
        // const glow = new THREE.Sprite(glowMat);
        // glow.scale.set(0.8, 0.8, 1);
        // glow.position.copy(basePos);
        // glow.renderOrder = 1;
        // scene.add(glow);
        // glowSprites.push(glow);

        // Layer 3: the logo icon itself (no tone mapping → true original colors)
        const mat = new THREE.SpriteMaterial({
          map: textures[i],
          transparent: true,
          opacity: 1,
          depthWrite: false,
          toneMapped: false,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.42, 0.42, 1);
        sprite.position.copy(basePos);
        sprite.renderOrder = 3;
        scene.add(sprite);
        sprites.push(sprite);
      });


      /* ─── Multi-colored background dust particles ─── */
      const PARTICLE_COLORS = [
        [36, 150, 237],  // Docker blue
        [109, 179, 63],  // Spring green
        [220, 56, 45],   // Redis red
        [255, 153, 0],   // AWS orange
        [94, 234, 212],  // teal accent
        [251, 186, 39],  // amber accent
      ];
      const pCount = 120;
      const particleSystems: THREE.Points[] = [];
      // Create a small particle system per color for a vibrant mix
      PARTICLE_COLORS.forEach(([pr, pg, pb]) => {
        const count = Math.floor(pCount / PARTICLE_COLORS.length);
        const geom = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          pos[i * 3] = (Math.random() - 0.5) * 4;
          pos[i * 3 + 1] = (Math.random() - 0.5) * 3;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 2 - 1;
        }
        geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));

        const dotC = document.createElement("canvas");
        dotC.width = 32;
        dotC.height = 32;
        const dc = dotC.getContext("2d")!;
        const dg = dc.createRadialGradient(16, 16, 0, 16, 16, 16);
        dg.addColorStop(0, `rgba(${pr},${pg},${pb},0.7)`);
        dg.addColorStop(0.5, `rgba(${pr},${pg},${pb},0.15)`);
        dg.addColorStop(1, `rgba(${pr},${pg},${pb},0)`);
        dc.fillStyle = dg;
        dc.fillRect(0, 0, 32, 32);

        const pts = new THREE.Points(
          geom,
          new THREE.PointsMaterial({
            map: new THREE.CanvasTexture(dotC),
            transparent: true,
            opacity: 0.55,
            size: 0.06,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true,
          })
        );
        scene.add(pts);
        particleSystems.push(pts);
      });

      /* ─── Animate ─── */
      const animate = () => {
        frameRef.current = requestAnimationFrame(animate);
        const t = clock.getElapsedTime();


        // Float each node (slow 6-10s cycle, no spinning)
        sprites.forEach((s, i) => {
          const bp = basePositions[i];
          const ph = i * 1.3;
          s.position.x = bp.x + Math.sin(t * 0.25 + ph) * 0.04 +  0.08;
          s.position.y = bp.y + Math.cos(t * 0.2 + ph * 0.7) * 0.05 +  0.08;
          s.position.z = bp.z + Math.sin(t * 0.15 + ph * 1.1) * 0.02;
        });


        // Update inner glows — breathing pulse
        glowSprites.forEach((g, i) => {
          g.position.copy(sprites[i].position);
          const sc = 0.75 + Math.sin(t * 0.6 + i * 1.1) * 0.15;
          g.scale.set(sc, sc, 1);
          (g.material as THREE.SpriteMaterial).opacity =
            0.7 + Math.sin(t * 0.5 + i * 0.9) * 0.2;
        });

        // Update outer bloom — slow expand/contract
        bloomSprites.forEach((b, i) => {
          b.position.copy(sprites[i].position);
          const sc = 1.3 + Math.sin(t * 0.35 + i * 1.4) * 0.25;
          b.scale.set(sc, sc, 1);
          (b.material as THREE.SpriteMaterial).opacity =
            0.5 + Math.sin(t * 0.4 + i * 0.7) * 0.2;
        });

        // Particle drift (all color groups)
        particleSystems.forEach((ps, gi) => {
          const pp = ps.geometry.attributes.position.array as Float32Array;
          const count = pp.length / 3;
          for (let i = 0; i < count; i++) {
            pp[i * 3 + 1] += Math.sin(t * 0.1 + i + gi * 7) * 0.0003;
            pp[i * 3] += Math.cos(t * 0.08 + i * 0.5 + gi * 3) * 0.0002;
          }
          ps.geometry.attributes.position.needsUpdate = true;
        });

        // Camera parallax
        camera.position.x = 0.15;
        camera.position.y =  0.1;
        camera.lookAt(0, 0, 0);

        warmLight.position.x = 1 +  0.5;
        warmLight.position.y = 1 + 0.5;

        renderer.render(scene, camera);
      };
      animate();

      /* ─── Resize ─── */
      const onResize = () => {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };
      window.addEventListener("resize", onResize);

      cleanupRef.current = () => {
        window.removeEventListener("resize", onResize);
        cancelAnimationFrame(frameRef.current);
        renderer.dispose();
        if (container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
      };
    })();

    return () => {
      cancelled = true;
      cleanupRef.current?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[400px]"
      style={{ position: "relative", overflow: "hidden" }}
      aria-hidden="true"
    />
  );
}
