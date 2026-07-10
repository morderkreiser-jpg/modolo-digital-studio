"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Icosahedron, MeshDistortMaterial } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import type { Mesh, Points } from "three";

/**
 * "Immersive" hero WebGL — a morphing, glowing molten-gold orb lit by warm lights, with bloom,
 * and the small gold particles orbiting it (the "palline che giravano"). They use a circular sprite
 * texture (so points are round, not gl.POINTS squares — the old artifact) with normal blending: a
 * bright gold that reads on the dark field and picks up a soft bloom, yet stays discreet where it
 * crosses the lit blob instead of blowing out to white (which additive blending did).
 * Kept deliberately light (no env cubemap, moderate poly) so it stays smooth everywhere.
 */
function Blob() {
  const ref = useRef<Mesh>(null);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const t = state.clock.elapsedTime;
    m.rotation.y = t * 0.14;
    m.rotation.x = t * 0.06;
    m.position.x = 0.7 + state.pointer.x * 0.25;
    m.position.y = state.pointer.y * 0.2;
  });
  return (
    <Icosahedron ref={ref} args={[1.6, 28]} position={[0.7, 0, 0]}>
      <MeshDistortMaterial
        color="#4a3208"
        emissive="#b5791c"
        emissiveIntensity={0.7}
        roughness={0.28}
        metalness={0.7}
        distort={0.4}
        speed={1.2}
      />
    </Icosahedron>
  );
}

// Soft round sprite so points render as circles (not gl.POINTS squares) — the fix for the artifact.
function circleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 32, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}

function Particles({ count = 90 }: { count?: number }) {
  const ref = useRef<Points>(null);
  const tex = useMemo(circleTexture, []);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2.9 + Math.random() * 3.6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta) + 0.6;
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.72;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 4 - 0.4;
    }
    return arr;
  }, [count]);
  useFrame((state) => {
    const p = ref.current;
    if (!p) return;
    p.rotation.y = state.clock.elapsedTime * 0.06;
    p.rotation.x = Math.sin(state.clock.elapsedTime * 0.12) * 0.12;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.09}
        map={tex}
        color="#f5d68a"
        transparent
        opacity={0.92}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

export default function HeroCanvas() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 1.6]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 3, 4]} intensity={130} color="#f0c256" />
      <pointLight position={[-5, -2, 3]} intensity={105} color="#d99038" />
      <pointLight position={[0, 3, -4]} intensity={75} color="#c98a3a" />
      <pointLight position={[2, -3, 2]} intensity={70} color="#ffe6b0" />
      <Blob />
      <Particles count={90} />
      <EffectComposer>
        <Bloom intensity={1.3} luminanceThreshold={0.16} luminanceSmoothing={0.92} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
