import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls, Sparkles, Environment, useTexture } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';

function createNoise(seed = 0) {
  const permutation = [];
  for (let i = 0; i < 256; i++) permutation[i] = i;
  
  const rng = (s) => {
    s = Math.sin(s + seed) * 10000;
    return s - Math.floor(s);
  };
  
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng(i) * (i + 1));
    [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
  }
  const p = [...permutation, ...permutation];
  
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  const grad = (hash, x, y, z) => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };
  
  return function noise3D(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(p[AA], xf, yf, zf), grad(p[BA], xf - 1, yf, zf), u),
           lerp(grad(p[AB], xf, yf - 1, zf), grad(p[BB], xf - 1, yf - 1, zf), u), v),
      lerp(lerp(grad(p[AA + 1], xf, yf, zf - 1), grad(p[BA + 1], xf - 1, yf, zf - 1), u),
           lerp(grad(p[AB + 1], xf, yf - 1, zf - 1), grad(p[BB + 1], xf - 1, yf - 1, zf - 1), u), v), w);
  };
}

function fbm(noise, x, y, z, octaves = 4) {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  
  for (let i = 0; i < octaves; i++) {
    value += amplitude * noise(x * frequency, y * frequency, z * frequency);
    maxValue += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  
  return value / maxValue;
}

const TEAL_DARK = new THREE.Color(0x0a2a2a);
const TEAL_MID = new THREE.Color(0x0d3838);
const TEAL_DEEP = new THREE.Color(0x082020);
const GOLD_BRIGHT = new THREE.Color(0xd4a000);
const GOLD_DARK = new THREE.Color(0x8a6000);

const roundedBoxGeo = new RoundedBoxGeometry(1, 1, 1, 2, 0.06);

function GoldMaterial() {
  const [diffuse, normal] = useTexture(['/gold.jpg', '/gold_normal.png']);
  
  diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  diffuse.repeat.set(0.5, 0.5);
  normal.repeat.set(0.5, 0.5);
  
  return (
    <meshStandardMaterial
      map={diffuse}
      normalMap={normal}
      normalScale={[1, 1]}
      roughness={0.25}
      metalness={0.95}
      envMapIntensity={1.5}
    />
  );
}

function TealMaterial() {
  const [diffuse, normal] = useTexture(['/teal.jpg', '/teal.png']);
  
  diffuse.wrapS = diffuse.wrapT = THREE.RepeatWrapping;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  diffuse.repeat.set(0.5, 0.5);
  normal.repeat.set(0.5, 0.5);
  
  return (
    <meshStandardMaterial
      map={diffuse}
      normalMap={normal}
      normalScale={[1, 1]}
      roughness={0.7}
      metalness={0.4}
      envMapIntensity={0.6}
    />
  );
}

function Chaos3DStructure({ noise }) {
  const tealMeshRef = useRef();
  const goldMeshRef = useRef();
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  
  const { tealBlocks, goldBlocks } = useMemo(() => {
    const teal = { positions: [], scales: [], colors: [] };
    const gold = { positions: [], scales: [], colors: [] };
    
    const size = 100;
    const spacing = 3.0;
    const threshold = 0.08;
    const goldThreshold = 0.52;
    
    for (let x = -size/2; x < size/2; x += spacing) {
      for (let y = -size/2; y < size/2; y += spacing) {
        for (let z = -size/2; z < size/2; z += spacing) {
          
          const nx = x * 0.025;
          const ny = y * 0.025;
          const nz = z * 0.025;
          
          const density = fbm(noise, nx, ny, nz, 4);
          
          if (density < threshold) continue;
          
          const distFromCenter = Math.sqrt(x*x*0.3 + y*y*0.5 + z*z*0.2);
          if (distFromCenter > size * 0.55) continue;
          
          const canyonFactor = Math.abs(x) < 18 ? 0.7 : 1.0;
          if (density < threshold + 0.15 * canyonFactor && Math.abs(x) < 15 && y > -30 && y < 40) continue;
          
          const goldNoise = noise(x * 0.06 + 100, y * 0.08, z * 0.06);
          const isGold = goldNoise > goldThreshold;
          
          const scaleVariation = 0.5 + Math.abs(noise(x * 0.3, y * 0.3, z * 0.3)) * 1.8;
          const scaleX = spacing * scaleVariation * (0.7 + Math.random() * 0.6);
          const scaleY = spacing * scaleVariation * (0.7 + Math.random() * 0.6);
          const scaleZ = spacing * scaleVariation * (0.7 + Math.random() * 0.6);
          
          const jitterX = (Math.random() - 0.5) * spacing * 0.4;
          const jitterY = (Math.random() - 0.5) * spacing * 0.4;
          const jitterZ = (Math.random() - 0.5) * spacing * 0.4;
          
          const pos = [x + jitterX, y + jitterY, z + jitterZ];
          const scale = [scaleX, scaleY, scaleZ];
          
          if (isGold) {
            gold.positions.push(pos);
            gold.scales.push(scale);
            const colorVar = Math.random();
            gold.colors.push(colorVar > 0.5 ? GOLD_BRIGHT.clone() : GOLD_DARK.clone());
          } else {
            teal.positions.push(pos);
            teal.scales.push(scale);
            const colorVar = Math.random();
            if (colorVar < 0.4) {
              teal.colors.push(TEAL_DARK.clone());
            } else if (colorVar < 0.75) {
              teal.colors.push(TEAL_MID.clone());
            } else {
              teal.colors.push(TEAL_DEEP.clone());
            }
          }
        }
      }
    }
    
    console.log(`Generated: ${teal.positions.length} teal, ${gold.positions.length} gold blocks`);
    return { tealBlocks: teal, goldBlocks: gold };
  }, [noise]);
  
  useEffect(() => {
    if (tealMeshRef.current && tealBlocks.positions.length > 0) {
      for (let i = 0; i < tealBlocks.positions.length; i++) {
        tempObject.position.set(...tealBlocks.positions[i]);
        tempObject.scale.set(...tealBlocks.scales[i]);
        tempObject.rotation.set(
          (Math.random() - 0.5) * 0.15,
          (Math.random() - 0.5) * 0.15,
          (Math.random() - 0.5) * 0.15
        );
        tempObject.updateMatrix();
        tealMeshRef.current.setMatrixAt(i, tempObject.matrix);
        tealMeshRef.current.setColorAt(i, tealBlocks.colors[i]);
      }
      tealMeshRef.current.instanceMatrix.needsUpdate = true;
      tealMeshRef.current.instanceColor.needsUpdate = true;
    }
  }, [tealBlocks, tempObject]);
  
  useEffect(() => {
    if (goldMeshRef.current && goldBlocks.positions.length > 0) {
      for (let i = 0; i < goldBlocks.positions.length; i++) {
        tempObject.position.set(...goldBlocks.positions[i]);
        tempObject.scale.set(...goldBlocks.scales[i]);
        tempObject.rotation.set(
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1,
          (Math.random() - 0.5) * 0.1
        );
        tempObject.updateMatrix();
        goldMeshRef.current.setMatrixAt(i, tempObject.matrix);
        goldMeshRef.current.setColorAt(i, goldBlocks.colors[i]);
      }
      goldMeshRef.current.instanceMatrix.needsUpdate = true;
      goldMeshRef.current.instanceColor.needsUpdate = true;
    }
  }, [goldBlocks, tempObject]);
  
  return (
    <>
      <instancedMesh 
        ref={tealMeshRef} 
        args={[roundedBoxGeo, null, Math.max(tealBlocks.positions.length, 1)]} 
        castShadow 
        receiveShadow
      >
        <TealMaterial />
      </instancedMesh>
      
      <instancedMesh 
        ref={goldMeshRef} 
        args={[roundedBoxGeo, null, Math.max(goldBlocks.positions.length, 1)]} 
        castShadow 
        receiveShadow
      >
        <GoldMaterial />
      </instancedMesh>
    </>
  );
}



function DustParticles() {
  return (
    <>
      <Sparkles
        count={600}
        scale={[100, 150, 200]}
        size={1.2}
        speed={0.04}
        opacity={0.3}
        color={0xd0d0d0}
        position={[0, 20, 0]}
      />
      <Sparkles
        count={400}
        scale={[80, 100, 150]}
        size={1.8}
        speed={0.06}
        opacity={0.5}
        color={0xffffff}
        position={[0, 40, -20]}
      />
      <Sparkles
        count={150}
        scale={[50, 80, 100]}
        size={2.5}
        speed={0.03}
        opacity={0.6}
        color={0xffd860}
        position={[0, 50, 0]}
      />
    </>
  );
}

const MOVEMENT_SPEED = 35;
const SHIFT_MULTIPLIER = 2.5;

function FPSControls({ onLockChange, onDebugUpdate }) {
  const { camera } = useThree();
  const controlsRef = useRef();
  const keysPressed = useRef({});
  const direction = useRef(new THREE.Vector3());
  const initialized = useRef(false);
  
  useEffect(() => {
    if (!initialized.current) {
      camera.position.set(0, 5, 45);
      camera.lookAt(0, 5, -50);
      initialized.current = true;
    }
  }, [camera]);
  
  useEffect(() => {
    const handleKeyDown = (e) => { keysPressed.current[e.code] = true; };
    const handleKeyUp = (e) => { keysPressed.current[e.code] = false; };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  
  useFrame((state, delta) => {
    const keys = keysPressed.current;
    const activeKeys = Object.entries(keys).filter(([k, v]) => v).map(([k]) => k);
    const isLocked = controlsRef.current?.isLocked ?? false;
    
    onDebugUpdate({
      position: {
        x: camera.position.x.toFixed(1),
        y: camera.position.y.toFixed(1),
        z: camera.position.z.toFixed(1),
      },
      keys: activeKeys.join(', ') || 'none',
      isLocked,
    });
    
    if (!isLocked) return;
    
    const speed = MOVEMENT_SPEED * (keys.ShiftLeft || keys.ShiftRight ? SHIFT_MULTIPLIER : 1);
    const moveZ = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
    const moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    
    const dir = direction.current;
    dir.set(moveX, 0, moveZ);
    if (dir.lengthSq() > 0) dir.normalize();
    dir.multiplyScalar(speed * delta);
    dir.applyQuaternion(camera.quaternion);
    camera.position.add(dir);
    
    if (keys.Space) camera.position.y += speed * delta;
    if (keys.ControlLeft || keys.ControlRight) camera.position.y -= speed * delta;
  });
  
  return (
    <PointerLockControls
      ref={controlsRef}
      onLock={() => onLockChange(true)}
      onUnlock={() => onLockChange(false)}
    />
  );
}

function Scene({ onLockChange, onDebugUpdate }) {
  const noise = useMemo(() => createNoise(42), []);
  
  return (
    <>
      <FPSControls onLockChange={onLockChange} onDebugUpdate={onDebugUpdate} />
      
      <color attach="background" args={[0x1a3038]} />
      <fogExp2 attach="fog" args={[0x203540, 0.009]} />
      
      <Environment preset="sunset" background={false} />
      
      <ambientLight intensity={1.2} color={0x607080} />
      <hemisphereLight args={[0xfff8e0, 0x304040, 1.4]} />
      
      <directionalLight
        position={[0, 120, 0]}
        intensity={10}
        color={0xfff8e0}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-far={250}
        shadow-camera-left={-120}
        shadow-camera-right={120}
        shadow-camera-top={120}
        shadow-camera-bottom={-120}
        shadow-bias={-0.0001}
      />
      
      <directionalLight
        position={[-50, 100, -30]}
        intensity={3}
        color={0xd0f0f0}
      />
      
      <directionalLight
        position={[30, 90, 40]}
        intensity={2.5}
        color={0xffe090}
      />
      
      <pointLight position={[0, 30, 0]} intensity={4} color={0x80c0c0} distance={80} decay={1.5} />
      <pointLight position={[-20, 50, -30]} intensity={3} color={0xa0e0e0} distance={100} decay={1.5} />
      <pointLight position={[20, 45, 30]} intensity={3.5} color={0xffc060} distance={90} decay={1.5} />
      
      <Chaos3DStructure noise={noise} />
      
      <DustParticles />
      
      <EffectComposer>
        <Bloom
          intensity={1.0}
          luminanceThreshold={0.35}
          luminanceSmoothing={0.7}
          radius={0.6}
        />
        <Vignette eskil={false} offset={0.4} darkness={0.35} />
      </EffectComposer>
    </>
  );
}

const overlayStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(2, 8, 8, 0.95)',
  color: '#608080',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  pointerEvents: 'none',
  zIndex: 100,
};

const titleStyle = {
  fontSize: '3rem',
  fontWeight: 100,
  letterSpacing: '0.5em',
  marginBottom: '1rem',
  color: '#80a0a0',
  textShadow: '0 0 30px rgba(100, 180, 180, 0.4)',
  textTransform: 'uppercase',
};

const subtitleStyle = {
  fontSize: '0.9rem',
  opacity: 0.4,
  marginBottom: '3rem',
  letterSpacing: '0.3em',
  color: '#a08040',
};

const instructionStyle = {
  fontSize: '0.9rem',
  opacity: 0.6,
  marginBottom: '0.5rem',
};

const keyStyle = {
  display: 'inline-block',
  padding: '0.2em 0.4em',
  margin: '0 0.12em',
  backgroundColor: 'rgba(100, 150, 150, 0.15)',
  border: '1px solid rgba(100, 150, 150, 0.25)',
  borderRadius: '2px',
  fontFamily: 'monospace',
  fontSize: '0.8em',
};

const clickPromptStyle = {
  marginTop: '2.5rem',
  fontSize: '1rem',
  color: '#506060',
  animation: 'pulse 3s ease-in-out infinite',
};

function ControlsOverlay({ isLocked }) {
  if (isLocked) {
    return (
      <div style={{
        position: 'absolute',
        bottom: '15px',
        left: '15px',
        color: 'rgba(100, 130, 130, 0.3)',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        fontSize: '0.7rem',
        pointerEvents: 'none',
        zIndex: 100,
      }}>
        <span style={{ ...keyStyle, opacity: 0.4 }}>ESC</span> unlock
      </div>
    );
  }
  
  return (
    <div style={overlayStyle}>
      <div style={titleStyle}>Verdigris</div>
      <div style={subtitleStyle}>Ancient Depths</div>
      <div style={instructionStyle}>
        <span style={keyStyle}>W</span>
        <span style={keyStyle}>A</span>
        <span style={keyStyle}>S</span>
        <span style={keyStyle}>D</span>
        {' '}move
      </div>
      <div style={instructionStyle}>
        <span style={keyStyle}>SPACE</span> up {'  '}
        <span style={keyStyle}>CTRL</span> down
      </div>
      <div style={instructionStyle}>
        <span style={keyStyle}>SHIFT</span> fast
      </div>
      <div style={clickPromptStyle}>
        [ click to enter ]
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}

function DebugOverlay({ debug }) {
  return (
    <div style={{
      position: 'absolute',
      top: 10,
      right: 10,
      background: 'rgba(2, 8, 8, 0.9)',
      color: '#508080',
      padding: '10px 14px',
      fontFamily: 'monospace',
      fontSize: '12px',
      borderRadius: '3px',
      border: '1px solid rgba(80, 128, 128, 0.2)',
      zIndex: 1000,
      minWidth: '160px',
    }}>
      <div style={{ marginBottom: 5, color: '#806020', fontWeight: 'bold', fontSize: '10px', letterSpacing: '0.1em' }}>DEBUG</div>
      <div>X: {debug.position.x}</div>
      <div>Y: {debug.position.y}</div>
      <div>Z: {debug.position.z}</div>
      <div style={{ marginTop: 5, borderTop: '1px solid rgba(80, 128, 128, 0.15)', paddingTop: 5 }}>
        Locked: <span style={{ color: debug.isLocked ? '#408040' : '#804040' }}>{debug.isLocked ? 'YES' : 'NO'}</span>
      </div>
      <div style={{ marginTop: 3, opacity: 0.5, fontSize: '11px' }}>Keys: {debug.keys}</div>
    </div>
  );
}

export default function App() {
  const [isLocked, setIsLocked] = useState(false);
  const [debug, setDebug] = useState({
    position: { x: '0', y: '0', z: '0' },
    keys: 'none',
    isLocked: false,
  });
  
  const handleDebugUpdate = useCallback((data) => setDebug(data), []);
  
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#020808' }}>
      <Canvas
        shadows
        camera={{ position: [0, 5, 45], fov: 75, near: 0.1, far: 300 }}
        gl={{ 
          antialias: true, 
          toneMapping: THREE.ACESFilmicToneMapping, 
          toneMappingExposure: 1.6,
          powerPreference: 'high-performance',
        }}
        dpr={[1, 1.5]}
      >
        <Scene onLockChange={setIsLocked} onDebugUpdate={handleDebugUpdate} />
      </Canvas>
      <ControlsOverlay isLocked={isLocked} />
      <DebugOverlay debug={debug} />
    </div>
  );
}
