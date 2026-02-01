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

const BLOCK_SIZES = [
  [1, 1], [1, 1], [1, 1],
  [1, 2], [2, 1],
  [1, 3], [3, 1],
  [2, 2],
  [2, 3], [3, 2],
];

const NOTCH_POSITIONS = ['top', 'bottom', 'left', 'right'];

function createNotchedBlockGeometry(width, height, depth, notchSide, notchRadius) {
  const shape = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(notchRadius, Math.min(w, h) * 0.8);
  
  shape.moveTo(-w, -h);
  
  if (notchSide === 'bottom') {
    shape.lineTo(-r, -h);
    shape.absarc(0, -h, r, Math.PI, 0, true);
    shape.lineTo(w, -h);
  } else {
    shape.lineTo(w, -h);
  }
  
  if (notchSide === 'right') {
    shape.lineTo(w, -r);
    shape.absarc(w, 0, r, -Math.PI/2, Math.PI/2, true);
    shape.lineTo(w, h);
  } else {
    shape.lineTo(w, h);
  }
  
  if (notchSide === 'top') {
    shape.lineTo(r, h);
    shape.absarc(0, h, r, 0, Math.PI, true);
    shape.lineTo(-w, h);
  } else {
    shape.lineTo(-w, h);
  }
  
  if (notchSide === 'left') {
    shape.lineTo(-w, r);
    shape.absarc(-w, 0, r, Math.PI/2, -Math.PI/2, true);
    shape.lineTo(-w, -h);
  } else {
    shape.lineTo(-w, -h);
  }
  
  const extrudeSettings = {
    depth: depth,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.03,
    bevelSegments: 2,
    curveSegments: 12,
  };
  
  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function BlockWallStructure({ noise }) {
  const tealMeshRef = useRef();
  const goldMeshRef = useRef();
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  
  const wallData = useMemo(() => {
    const tealStandard = { positions: [], scales: [], colors: [] };
    const goldStandard = { positions: [], scales: [], colors: [] };
    const tealNotched = [];
    const goldNotched = [];
    
    const wallWidth = 60;
    const wallHeight = 80;
    const unitSize = 1.5;
    const notchRadius = 0.25;
    
    const goldZoneStart = Math.floor(wallWidth * 0.30);
    const goldZoneEnd = Math.floor(wallWidth * 0.70);
    
    const seededRandom = (seed) => {
      const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    
    const occupied = new Set();
    const isOccupied = (x, y, w, h) => {
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          if (occupied.has(`${x + dx},${y + dy}`)) return true;
        }
      }
      return false;
    };
    const markOccupied = (x, y, w, h) => {
      for (let dx = 0; dx < w; dx++) {
        for (let dy = 0; dy < h; dy++) {
          occupied.add(`${x + dx},${y + dy}`);
        }
      }
    };
    
    let blockIndex = 0;
    
    for (let gx = 0; gx < wallWidth; gx++) {
      for (let gy = 0; gy < wallHeight; gy++) {
        if (occupied.has(`${gx},${gy}`)) continue;
        
        const seed = blockIndex * 17.31 + gx * 7.13 + gy * 3.71;
        const sizeRand = seededRandom(seed);
        
        let blockW = 1, blockH = 1;
        const sizeIdx = Math.floor(sizeRand * BLOCK_SIZES.length);
        const [candidateW, candidateH] = BLOCK_SIZES[sizeIdx];
        
        if (gx + candidateW <= wallWidth && gy + candidateH <= wallHeight) {
          if (!isOccupied(gx, gy, candidateW, candidateH)) {
            blockW = candidateW;
            blockH = candidateH;
          }
        }
        
        markOccupied(gx, gy, blockW, blockH);
        
        const zoneBoundaryNoise = (seededRandom(seed * 2.1) - 0.5) * 3;
        const effectiveGoldStart = goldZoneStart + zoneBoundaryNoise;
        const effectiveGoldEnd = goldZoneEnd + zoneBoundaryNoise;
        const blockCenterX = gx + blockW / 2;
        const isGold = blockCenterX >= effectiveGoldStart && blockCenterX <= effectiveGoldEnd;
        
        const depthNoise = seededRandom(seed * 3.7);
        const depth = unitSize * (0.8 + depthNoise * 0.4);
        
        const worldX = (gx + blockW / 2 - wallWidth / 2) * unitSize;
        const worldY = (gy + blockH / 2 - wallHeight / 2) * unitSize;
        const worldZ = (depthNoise - 0.5) * unitSize * 0.15;
        
        const hasNotch = seededRandom(seed * 5.3) < 0.25;
        
        const colorVar = seededRandom(seed * (isGold ? 8.1 : 9.3));
        let color;
        if (isGold) {
          color = colorVar > 0.5 ? GOLD_BRIGHT.clone() : GOLD_DARK.clone();
        } else {
          if (colorVar < 0.4) color = TEAL_DARK.clone();
          else if (colorVar < 0.75) color = TEAL_MID.clone();
          else color = TEAL_DEEP.clone();
        }
        
        if (hasNotch) {
          const notchIdx = Math.floor(seededRandom(seed * 6.7) * 4);
          const notchSide = NOTCH_POSITIONS[notchIdx];
          const notchData = {
            position: [worldX, worldY, worldZ],
            width: blockW * unitSize,
            height: blockH * unitSize,
            depth: depth,
            notchSide,
            notchRadius: notchRadius * unitSize,
            color,
          };
          if (isGold) {
            goldNotched.push(notchData);
          } else {
            tealNotched.push(notchData);
          }
        } else {
          const target = isGold ? goldStandard : tealStandard;
          target.positions.push([worldX, worldY, worldZ]);
          target.scales.push([blockW * unitSize, blockH * unitSize, depth]);
          target.colors.push(color);
        }
        
        blockIndex++;
      }
    }
    
    console.log(`Wall: ${tealStandard.positions.length} teal std, ${tealNotched.length} teal notched, ${goldStandard.positions.length} gold std, ${goldNotched.length} gold notched`);
    return { tealStandard, goldStandard, tealNotched, goldNotched };
  }, [noise]);
  
  useEffect(() => {
    if (tealMeshRef.current && wallData.tealStandard.positions.length > 0) {
      for (let i = 0; i < wallData.tealStandard.positions.length; i++) {
        const [x, y, z] = wallData.tealStandard.positions[i];
        const [sx, sy, sz] = wallData.tealStandard.scales[i];
        tempObject.position.set(x, y, z);
        tempObject.scale.set(sx, sy, sz);
        tempObject.rotation.set(0, 0, 0);
        tempObject.updateMatrix();
        tealMeshRef.current.setMatrixAt(i, tempObject.matrix);
        tealMeshRef.current.setColorAt(i, wallData.tealStandard.colors[i]);
      }
      tealMeshRef.current.instanceMatrix.needsUpdate = true;
      tealMeshRef.current.instanceColor.needsUpdate = true;
    }
  }, [wallData.tealStandard, tempObject]);
  
  useEffect(() => {
    if (goldMeshRef.current && wallData.goldStandard.positions.length > 0) {
      for (let i = 0; i < wallData.goldStandard.positions.length; i++) {
        const [x, y, z] = wallData.goldStandard.positions[i];
        const [sx, sy, sz] = wallData.goldStandard.scales[i];
        tempObject.position.set(x, y, z);
        tempObject.scale.set(sx, sy, sz);
        tempObject.rotation.set(0, 0, 0);
        tempObject.updateMatrix();
        goldMeshRef.current.setMatrixAt(i, tempObject.matrix);
        goldMeshRef.current.setColorAt(i, wallData.goldStandard.colors[i]);
      }
      goldMeshRef.current.instanceMatrix.needsUpdate = true;
      goldMeshRef.current.instanceColor.needsUpdate = true;
    }
  }, [wallData.goldStandard, tempObject]);
  
  const unitBoxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  
  return (
    <>
      <instancedMesh 
        ref={tealMeshRef} 
        args={[unitBoxGeo, null, Math.max(wallData.tealStandard.positions.length, 1)]} 
        castShadow 
        receiveShadow
      >
        <TealMaterial />
      </instancedMesh>
      
      <instancedMesh 
        ref={goldMeshRef} 
        args={[unitBoxGeo, null, Math.max(wallData.goldStandard.positions.length, 1)]} 
        castShadow 
        receiveShadow
      >
        <GoldMaterial />
      </instancedMesh>
      
      {wallData.tealNotched.map((block, i) => (
        <NotchedBlock key={`teal-notch-${i}`} {...block} materialType="teal" />
      ))}
      
      {wallData.goldNotched.map((block, i) => (
        <NotchedBlock key={`gold-notch-${i}`} {...block} materialType="gold" />
      ))}
    </>
  );
}

function NotchedBlock({ position, width, height, depth, notchSide, notchRadius, color, materialType }) {
  const geometry = useMemo(() => {
    return createNotchedBlockGeometry(width, height, depth, notchSide, notchRadius);
  }, [width, height, depth, notchSide, notchRadius]);
  
  const [goldDiffuse, goldNormal] = useTexture(['/gold.jpg', '/gold_normal.png']);
  const [tealDiffuse, tealNormal] = useTexture(['/teal.jpg', '/teal.png']);
  
  const material = useMemo(() => {
    if (materialType === 'gold') {
      goldDiffuse.wrapS = goldDiffuse.wrapT = THREE.RepeatWrapping;
      goldNormal.wrapS = goldNormal.wrapT = THREE.RepeatWrapping;
      goldDiffuse.repeat.set(0.5, 0.5);
      goldNormal.repeat.set(0.5, 0.5);
      return new THREE.MeshStandardMaterial({
        map: goldDiffuse,
        normalMap: goldNormal,
        normalScale: new THREE.Vector2(1, 1),
        roughness: 0.2,
        metalness: 1.0,
        envMapIntensity: 2.0,
        emissive: new THREE.Color(0x302000),
        emissiveIntensity: 0.3,
        color: color,
      });
    } else {
      tealDiffuse.wrapS = tealDiffuse.wrapT = THREE.RepeatWrapping;
      tealNormal.wrapS = tealNormal.wrapT = THREE.RepeatWrapping;
      tealDiffuse.repeat.set(0.5, 0.5);
      tealNormal.repeat.set(0.5, 0.5);
      return new THREE.MeshStandardMaterial({
        map: tealDiffuse,
        normalMap: tealNormal,
        normalScale: new THREE.Vector2(1, 1),
        roughness: 0.5,
        metalness: 0.7,
        envMapIntensity: 1.2,
        emissive: new THREE.Color(0x0a2020),
        emissiveIntensity: 0.15,
        color: color,
      });
    }
  }, [materialType, color, goldDiffuse, goldNormal, tealDiffuse, tealNormal]);
  
  return (
    <mesh
      geometry={geometry}
      material={material}
      position={position}
      castShadow
      receiveShadow
    />
  );
}

// Keep old component for reference (commented out)
/*
function Chaos3DStructure({ noise }) {
  // ... original implementation
}
*/



function DustParticles() {
  return (
    <>
      <Sparkles
        count={500}
        scale={[100, 130, 80]}
        size={1.0}
        speed={0.015}
        opacity={0.3}
        color={0x808080}
        position={[0, 0, 30]}
      />
      <Sparkles
        count={200}
        scale={[60, 80, 40]}
        size={2.0}
        speed={0.02}
        opacity={0.6}
        color={0xffd040}
        position={[0, 20, 20]}
      />
      <Sparkles
        count={100}
        scale={[40, 60, 30]}
        size={2.5}
        speed={0.01}
        opacity={0.7}
        color={0x40ffff}
        position={[-20, -10, 25]}
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
      camera.position.set(0, 0, 80);
      camera.lookAt(0, 0, 0);
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

function Scene({ onLockChange, onDebugUpdate }) {
  const noise = useMemo(() => createNoise(42), []);
  const { gl } = useThree();
  
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
        position={[30, 80, 100]}
        intensity={config.directionalIntensity}
        color={0xfffef8}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-far={300}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-bias={-0.0001}
      />
      
      <pointLight position={[0, 0, 60]} intensity={3} color={0xffffff} distance={200} decay={2} />
      <pointLight position={[-30, 20, 50]} intensity={2} color={0x80ffff} distance={150} decay={2} />
      <pointLight position={[30, -20, 50]} intensity={2} color={0xffd080} distance={150} decay={2} />
      
      <BlockWallStructure noise={noise} />
      
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
        camera={{ position: [0, 0, 80], fov: 60, near: 0.1, far: 500 }}
        gl={{ 
          antialias: true, 
          toneMapping: THREE.ACESFilmicToneMapping, 
          toneMappingExposure: 2.2,
          powerPreference: 'high-performance',
        }}
        dpr={[1, 1.5]}
      >
        <Scene 
          onLockChange={handleLockChange} 
          onDebugUpdate={handleDebugUpdate}
        />
      </Canvas>
      <ControlsOverlay hasEntered={hasEntered} />
      <DebugOverlay debug={debug} />
      <style>{levaStyles}</style>
    </div>
  );
}
