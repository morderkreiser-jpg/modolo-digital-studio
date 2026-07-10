"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Icosahedron, MeshDistortMaterial } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useRef } from "react";
import type { Mesh } from "three";

/**
 * "Immersive" hero WebGL — a morphing, glowing energy orb lit by neon lights, with bloom.
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

export default function HeroCanvas() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 1.6]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 3, 4]} intensity={130} color="#f0c256" />
      <pointLight position={[-5, -2, 3]} intensity={105} color="#d99038" />
      <pointLight position={[0, 3, -4]} intensity={75} color="#c98a3a" />
      <pointLight position={[2, -3, 2]} intensity={70} color="#ffe6b0" />
      <Blob />
      <EffectComposer>
        <Bloom intensity={1.3} luminanceThreshold={0.16} luminanceSmoothing={0.92} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
