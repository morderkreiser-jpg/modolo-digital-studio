"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Icosahedron, MeshDistortMaterial, Environment, Lightformer, ContactShadows } from "@react-three/drei";
import { useRef } from "react";
import type { Mesh } from "three";

/**
 * LIGHT immersive hero WebGL — a morphing REFLECTIVE gold blob on cream. No bloom (glow needs a
 * dark field); instead the gold is polished metal reflecting an inline Lightformer environment, so
 * it reads as a real gold object floating over the paper. A soft contact shadow grounds it.
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
    <Icosahedron ref={ref} args={[1.55, 42]} position={[0.7, 0, 0]}>
      <MeshDistortMaterial color="#c08f3e" roughness={0.44} metalness={0.9} envMapIntensity={0.85} distort={0.4} speed={1.2} />
    </Icosahedron>
  );
}

export default function HeroCanvasLight() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 1.6]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={0.65} />
      <directionalLight position={[5, 6, 5]} intensity={2.2} color="#fff6e2" />
      <ContactShadows position={[0.7, -1.9, 0]} opacity={0.32} scale={9} blur={2.6} far={4} color="#3a2a10" />
      <Blob />
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={2.2} position={[3, 4, 4]} scale={7} color="#ffffff" />
        <Lightformer form="rect" intensity={1.3} position={[-4, 1, 3]} scale={5} color="#ffe6bf" />
        <Lightformer form="circle" intensity={1.6} position={[0, -3, 3]} scale={4} color="#fff2d8" />
        <Lightformer form="ring" intensity={1} position={[2, 2, -3]} scale={5} color="#e9c98f" />
      </Environment>
    </Canvas>
  );
}
