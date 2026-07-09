"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Icosahedron, MeshDistortMaterial, Sparkles } from "@react-three/drei";
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
        color="#3a2c0d"
        emissive="#8a6418"
        emissiveIntensity={0.55}
        roughness={0.22}
        metalness={0.6}
        distort={0.42}
        speed={1.3}
      />
    </Icosahedron>
  );
}

export default function HeroCanvas() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 1.6]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={0.35} />
      <pointLight position={[5, 3, 4]} intensity={125} color="#e6c060" />
      <pointLight position={[-5, -2, 3]} intensity={100} color="#d4a344" />
      <pointLight position={[0, 3, -4]} intensity={70} color="#c9a25a" />
      <pointLight position={[2, -3, 2]} intensity={80} color="#fff2d8" />
      <Blob />
      <Sparkles count={90} scale={[11, 7, 6]} size={5} speed={0.35} opacity={0.7} color="#e8c877" />
      <Sparkles count={40} scale={[9, 6, 5]} size={7} speed={0.2} opacity={0.6} color="#c9a25a" />
      <EffectComposer>
        <Bloom intensity={1.35} luminanceThreshold={0.13} luminanceSmoothing={0.9} mipmapBlur />
      </EffectComposer>
    </Canvas>
  );
}
