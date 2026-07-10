"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Icosahedron, MeshDistortMaterial, Environment, Lightformer, ContactShadows } from "@react-three/drei";
import { useRef, useMemo } from "react";
import * as THREE from "three";
import type { Mesh, Points } from "three";

/**
 * LIGHT immersive hero WebGL — a morphing REFLECTIVE gold blob on cream, with the small gold
 * particles orbiting it (the "palline che giravano" the client liked from the dark hero, adapted
 * to light: solid gold dots via a circular sprite texture + normal blending, so NO square edges).
 * No bloom (glow needs a dark field); the gold reads via reflections of an inline Lightformer env.
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
      const r = 2.8 + Math.random() * 3.4;
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
      <pointsMaterial size={0.088} map={tex} color="#9c6e24" transparent opacity={0.85} sizeAttenuation depthWrite={false} />
    </points>
  );
}

export default function HeroCanvasLight() {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 1.6]} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
      <ambientLight intensity={0.65} />
      <directionalLight position={[5, 6, 5]} intensity={2.2} color="#fff6e2" />
      <ContactShadows position={[0.7, -1.9, 0]} opacity={0.32} scale={9} blur={2.6} far={4} color="#3a2a10" />
      <Blob />
      <Particles count={90} />
      <Environment resolution={128}>
        <Lightformer form="rect" intensity={2.2} position={[3, 4, 4]} scale={7} color="#ffffff" />
        <Lightformer form="rect" intensity={1.3} position={[-4, 1, 3]} scale={5} color="#ffe6bf" />
        <Lightformer form="circle" intensity={1.6} position={[0, -3, 3]} scale={4} color="#fff2d8" />
        <Lightformer form="ring" intensity={1} position={[2, 2, -3]} scale={5} color="#e9c98f" />
      </Environment>
    </Canvas>
  );
}
