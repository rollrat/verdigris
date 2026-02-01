import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls, Sparkles, Environment, useTexture } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';
import { useControls, Leva } from 'leva';

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

function domainWarp(noise, x, y, z, strength = 1.0) {
  const warpX = fbm(noise, x + 100, y, z, 3) * strength;
  const warpY = fbm(noise, x, y + 100, z, 3) * strength;
  const warpZ = fbm(noise, x, y, z + 100, 3) * strength;
  return [x + warpX, y + warpY, z + warpZ];
}

function ridgedNoise(noise, x, y, z) {
  return 1.0 - Math.abs(fbm(noise, x, y, z, 5));
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
      roughness={0.2}
      metalness={1.0}
      envMapIntensity={2.0}
      emissive={0x302000}
      emissiveIntensity={0.3}
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
      roughness={0.5}
      metalness={0.7}
      envMapIntensity={1.2}
      emissive={0x0a2020}
      emissiveIntensity={0.15}
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
    
    const sizeX = 120;
    const sizeY = 160;
    const sizeZ = 160;
    const spacing = 3.5;
    const baseThreshold = 0.45;
    const goldThreshold = 0.58;
    
    const seededRandom = (seed) => {
      const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    
    let blockIndex = 0;
    
    for (let x = -sizeX/2; x < sizeX/2; x += spacing) {
      for (let y = -sizeY/2; y < sizeY/2; y += spacing) {
        for (let z = -sizeZ/2; z < sizeZ/2; z += spacing) {
          
          const [wx, wy, wz] = domainWarp(noise, x * 0.012, y * 0.008, z * 0.012, 8.0);
          
          const baseDensity = ridgedNoise(noise, wx, wy, wz);
          const pillarNoise = fbm(noise, x * 0.02, y * 0.003, z * 0.02, 4);
          const caveNoise = fbm(noise, x * 0.015 + 50, y * 0.015, z * 0.015 + 50, 5);
          
          const verticalBias = Math.exp(-Math.abs(y) * 0.003) * 0.3;
          const density = baseDensity * 0.5 + pillarNoise * 0.35 + verticalBias + caveNoise * 0.15;
          
          const distXZ = Math.sqrt(x*x + z*z);
          const corridorWidth = 12 + fbm(noise, y * 0.02, 0, 0, 2) * 8;
          const inCorridor = distXZ < corridorWidth && y > -80 && y < 80;
          
          const threshold = inCorridor ? baseThreshold + 0.25 : baseThreshold;
          
          if (density < threshold) continue;
          
          const falloff = Math.max(0, 1 - Math.pow(distXZ / (sizeX * 0.6), 2));
          if (seededRandom(blockIndex * 3.7) > falloff + 0.3) {
            blockIndex++;
            continue;
          }
          
          const goldNoise1 = noise(x * 0.04 + 100, y * 0.06, z * 0.04);
          const goldNoise2 = noise(x * 0.08, y * 0.03 + 200, z * 0.08);
          const isGold = goldNoise1 > goldThreshold || (goldNoise2 > 0.6 && y > 0);
          
          const scaleNoise = Math.abs(noise(x * 0.1, y * 0.1, z * 0.1));
          const rand1 = seededRandom(blockIndex * 1.1);
          const rand2 = seededRandom(blockIndex * 2.3);
          const rand3 = seededRandom(blockIndex * 3.7);
          
          const cubeSize = spacing * (0.6 + scaleNoise * 1.5);
          
          const jitterX = (rand1 - 0.5) * spacing * 0.6;
          const jitterY = (rand2 - 0.5) * spacing * 0.6;
          const jitterZ = (rand3 - 0.5) * spacing * 0.6;
          
          const pos = [x + jitterX, y + jitterY, z + jitterZ];
          const scale = [cubeSize, cubeSize, cubeSize];
          
          if (isGold) {
            gold.positions.push(pos);
            gold.scales.push(scale);
            const colorVar = seededRandom(blockIndex * 5.1);
            gold.colors.push(colorVar > 0.5 ? GOLD_BRIGHT.clone() : GOLD_DARK.clone());
          } else {
            teal.positions.push(pos);
            teal.scales.push(scale);
            const colorVar = seededRandom(blockIndex * 7.3);
            if (colorVar < 0.4) {
              teal.colors.push(TEAL_DARK.clone());
            } else if (colorVar < 0.75) {
              teal.colors.push(TEAL_MID.clone());
            } else {
              teal.colors.push(TEAL_DEEP.clone());
            }
          }
          
          blockIndex++;
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
        count={800}
        scale={[150, 250, 250]}
        size={1.0}
        speed={0.02}
        opacity={0.2}
        color={0x606060}
        position={[0, 30, 0]}
      />
      <Sparkles
        count={300}
        scale={[80, 150, 150]}
        size={2.0}
        speed={0.03}
        opacity={0.5}
        color={0xffd040}
        position={[0, 60, -30]}
      />
      <Sparkles
        count={200}
        scale={[60, 100, 100]}
        size={3.0}
        speed={0.015}
        opacity={0.8}
        color={0xffb020}
        position={[10, 80, 0]}
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
      camera.position.set(0, 0, 25);
      camera.lookAt(0, 20, -100);
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
      selector="#game-canvas"
      onLock={() => onLockChange(true)}
      onUnlock={() => onLockChange(false)}
    />
  );
}

function Scene({ onLockChange, onDebugUpdate, config }) {
  const noise = useMemo(() => createNoise(42), []);
  const { gl } = useThree();

  useEffect(() => {
    gl.toneMappingExposure = config.exposure;
  }, [gl, config.exposure]);
  
  return (
    <>
      <FPSControls onLockChange={onLockChange} onDebugUpdate={onDebugUpdate} />
      
      <color attach="background" args={[config.bgColor]} />
      <fogExp2 attach="fog" args={[config.bgColor, config.fogDensity]} />
      
      <Environment preset="apartment" background={false} />
      
      <ambientLight intensity={config.ambientIntensity} color={0xffffff} />
      <hemisphereLight args={[0xffffff, 0xc0c0c0, config.hemisphereIntensity]} />
      
      <directionalLight
        position={[50, 200, 30]}
        intensity={config.directionalIntensity}
        color={0xfffef8}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-far={400}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={200}
        shadow-camera-bottom={-200}
        shadow-bias={-0.0001}
      />
      
      <pointLight position={[0, -50, 0]} intensity={2} color={0xffffff} distance={150} decay={2} />
      <pointLight position={[-40, -30, -60]} intensity={1.5} color={0xe0e0e0} distance={120} decay={2} />
      <pointLight position={[30, 20, 40]} intensity={2} color={0xfff0d0} distance={100} decay={2} />
      
      <Chaos3DStructure noise={noise} />
      
      <DustParticles />
      
      <EffectComposer>
        <Bloom
          intensity={config.bloomIntensity}
          luminanceThreshold={0.25}
          luminanceSmoothing={0.8}
          radius={0.8}
        />
        <Vignette eskil={false} offset={0.35} darkness={config.vignetteDarkness} />
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

function ControlsOverlay({ hasEntered }) {
  if (hasEntered) return null;
  
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



const levaStyles = `
  .leva-c-kWgxhW {
    right: auto !important;
    left: 20px !important;
  }
  [class*="leva-"] {
    pointer-events: auto !important;
  }
`;

export default function App() {
  const [isLocked, setIsLocked] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [debug, setDebug] = useState({
    position: { x: '0', y: '0', z: '0' },
    keys: 'none',
    isLocked: false,
  });
  
  const config = useControls('Atmosphere', {
    bgColor: { value: '#c8dce8', label: 'Background' },
    ambientIntensity: { value: 2.5, min: 0, max: 5, step: 0.01, label: 'Ambient' },
    hemisphereIntensity: { value: 2.5, min: 0, max: 5, step: 0.05, label: 'Hemisphere' },
    directionalIntensity: { value: 25, min: 0, max: 50, step: 0.5, label: 'Sun Light' },
    fogDensity: { value: 0.003, min: 0, max: 0.03, step: 0.001, label: 'Fog' },
    bloomIntensity: { value: 0.5, min: 0, max: 3, step: 0.1, label: 'Bloom' },
    exposure: { value: 2.2, min: 0.5, max: 4, step: 0.05, label: 'Exposure' },
    vignetteDarkness: { value: 0.1, min: 0, max: 1, step: 0.05, label: 'Vignette' },
  });

  const handleLockChange = useCallback((locked) => {
    setIsLocked(locked);
    if (locked && !hasEntered) {
      setHasEntered(true);
    }
  }, [hasEntered]);
  
  const handleDebugUpdate = useCallback((data) => setDebug(data), []);
  
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#020808' }}>
      <Leva 
        collapsed={false}
        oneLineLabels={false}
        flat={false}

        theme={{
          colors: {
            elevation1: 'rgba(2, 8, 8, 0.95)',
            elevation2: 'rgba(10, 24, 24, 0.95)',
            elevation3: 'rgba(20, 40, 40, 0.9)',
            accent1: '#d4a000',
            accent2: '#b08000',
            accent3: '#906000',
            highlight1: '#80a0a0',
            highlight2: '#608080',
            highlight3: '#405050',
            vivid1: '#d4a000',
            folderWidgetColor: '#d4a000',
            folderTextColor: '#80a0a0',
            toolTipBackground: 'rgba(2, 8, 8, 0.95)',
            toolTipText: '#80a0a0',
          },
          radii: {
            xs: '2px',
            sm: '3px',
            lg: '4px',
          },
          space: {
            sm: '6px',
            md: '12px',
            rowGap: '8px',
            colGap: '8px',
          },
          fonts: {
            mono: 'monospace',
            sans: 'system-ui, sans-serif',
          },
          fontSizes: {
            root: '12px',
            toolTip: '11px',
          },
          sizes: {
            rootWidth: '300px',
            controlWidth: '160px',
            numberInputMinWidth: '56px',
            scrubberWidth: '8px',
            scrubberHeight: '16px',
            rowHeight: '28px',
            folderTitleHeight: '24px',
            checkboxSize: '16px',
            joystickWidth: '100px',
            joystickHeight: '100px',
            colorPickerWidth: '160px',
            colorPickerHeight: '100px',
            imagePreviewWidth: '100px',
            imagePreviewHeight: '100px',
            monitorHeight: '64px',
            titleBarHeight: '39px',
          },
          borderWidths: {
            root: '1px',
            input: '1px',
            focus: '1px',
            hover: '1px',
            active: '1px',
            folder: '1px',
          },
          fontWeights: {
            label: 'normal',
            folder: 'normal',
            button: 'normal',
          },
        }}
      />
      <Canvas
        id="game-canvas"
        shadows
        camera={{ position: [0, 0, 25], fov: 70, near: 0.1, far: 500 }}
        gl={{ 
          antialias: true, 
          toneMapping: THREE.ACESFilmicToneMapping, 
          toneMappingExposure: config.exposure,
          powerPreference: 'high-performance',
        }}
        dpr={[1, 1.5]}
      >
        <Scene 
          onLockChange={handleLockChange} 
          onDebugUpdate={handleDebugUpdate} 
          config={config}
        />
      </Canvas>
      <ControlsOverlay hasEntered={hasEntered} />
      <DebugOverlay debug={debug} />
      <style>{levaStyles}</style>
    </div>
  );
}
