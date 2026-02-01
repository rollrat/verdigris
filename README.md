# Verdigris

A 3D procedural "Ancient Sci-Fi Ruins" scene built with React Three Fiber. Explore massive geometric metal structures with oxidized copper and gold materials, atmospheric fog, and dramatic lighting.

![Screenshot](스크린샷%202026-02-01%20095633.png)

## Features

- **Procedural Generation**: FBM (Fractal Brownian Motion) noise creates chaotic, cave-like geometry
- **Dual Materials**: Oxidized teal copper (~80%) and gold veins (~20%) with PBR textures
- **Atmospheric Effects**: Exponential fog, dust particles, bloom, and vignette
- **FPS Controls**: WASD movement with mouse look

## Controls

| Key | Action |
|-----|--------|
| `W` `A` `S` `D` | Move |
| `Mouse` | Look around |
| `Space` | Fly up |
| `Ctrl` | Fly down |
| `Shift` | Sprint |
| `Esc` | Unlock cursor |

## Getting Started

```bash
npm install
npm run dev
```

## Tech Stack

- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)
- [Drei](https://github.com/pmndrs/drei)
- [Three.js](https://threejs.org/)
- [Vite](https://vitejs.dev/)

## License

MIT
