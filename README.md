# MyCraft 🏗️

A sophisticated Minecraft-inspired voxel sandbox game that runs entirely in your web browser. Built with modern web technologies, MyCraft delivers a full-featured block-building experience with advanced graphics, procedural terrain generation, physics simulation, and immersive audio.


## ✨ Features

### 🌍 World Generation & Exploration
- **Island-based terrain generation** using simplex noise with sophisticated heightmapping
- **Infinite streaming chunks** that load dynamically as you explore
- **Multiple biomes** with varying terrain features including lakes, hills, and coastal areas
- **Ocean system** with realistic water physics and underwater environments
- **Save/load world states** with encrypted file storage

### 🎮 Gameplay Mechanics
- **First-person controls** with smooth mouse look and WASD movement
- **Block placement and mining** with instant world updates
- **Physics simulation** including gravity, collision detection, and water physics
- **Swimming mechanics** with realistic buoyancy and underwater movement
- **Hotbar inventory system** with block selection and placement
- **Player body representation** with animated first-person arms

### 🎨 Advanced Graphics & Rendering
- **Modern rendering pipeline** powered by Three.js
- **Post-processing effects** including:
  - Screen Space Ambient Occlusion (SSAO)
  - Bloom lighting effects
  - Volumetric lighting and fog
  - Lens flare effects
- **Dynamic lighting system** with day/night cycle
- **Shadow mapping** with cascaded shadow maps
- **Atmospheric effects**:
  - Physically-based sky dome
  - Dynamic cloud system with shadows
  - Star field for nighttime
  - Ocean horizon with seamless water rendering
- **Texture atlas system** with pixel-perfect block textures
- **Grass billboards** for enhanced environmental detail

### 🔊 Immersive Audio
- **Environmental audio** that responds to player location
- **3D positional sound effects** for footsteps, water, and interactions
- **Dynamic background music** with ambient atmospheric tracks
- **Underwater sound effects** with realistic audio filtering
- **Block interaction sounds** for mining and placement

### 🛠️ Technical Excellence
- **Web Workers** for non-blocking world generation and mesh processing
- **Efficient chunk meshing** with face culling optimization
- **Memory management** with geometry reuse and cleanup
- **Comprehensive test suite** covering core game systems
- **TypeScript throughout** with strict type checking
- **Real-time performance monitoring** with FPS tracking

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn package manager
- Modern web browser with WebGL 2.0 support

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd MyCraft
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

4. **Open your browser**
   Navigate to `http://localhost:5173` and start playing!

### Building for Production
```bash
npm run build
npm run preview
```

## 🎯 Controls

| Key | Action |
|-----|--------|
| **W/A/S/D** | Move forward/left/backward/right |
| **Mouse** | Look around (auto pointer lock) |
| **Space** | Jump / Swim up |
| **Shift** | Sprint / Swim faster |
| **Left Click** | Mine/destroy blocks |
| **Right Click** | Place blocks |
| **1-9** | Select hotbar slot |
| **Escape** | Pause game / Release mouse lock |

## 📁 Project Structure

```
src/
├── app/                    # React UI components
│   ├── AudioPanel.tsx      # Audio controls
│   ├── CanvasHost.tsx      # Main game canvas
│   ├── DebugPanel.tsx      # Debug information overlay
│   ├── Hotbar.tsx          # Block selection UI
│   └── StartPanel.tsx      # Game start screen
├── engine/                 # Pure game engine (React-free)
│   ├── core/
│   │   └── Engine.ts       # Main game loop and system coordinator
│   ├── render/             # Graphics and rendering systems
│   │   ├── Atlas.ts        # Texture atlas management
│   │   ├── BlockMaterial.ts # Block shader materials
│   │   ├── ChunkRenderer.ts # Chunk mesh rendering
│   │   ├── Environment.ts  # Environment mapping
│   │   ├── FirstPersonBody.ts # Player body rendering
│   │   ├── GrassBillboardSystem.ts # Grass rendering
│   │   ├── atmosphere/     # Sky, clouds, stars
│   │   ├── lighting/       # Sun and lighting systems
│   │   ├── postprocessing/ # Post-processing effects
│   │   ├── water/          # Water and ocean rendering
│   │   └── settings/       # Graphics configuration
│   ├── systems/            # Game systems
│   │   ├── Input.ts        # Input handling and pointer lock
│   │   ├── InteractionSystem.ts # Block placement/mining
│   │   ├── PlayerController.ts # Player movement and physics
│   │   └── SelectionSystem.ts # Block selection raycast
│   ├── world/              # World generation and management
│   │   ├── World.ts        # World container and chunk management
│   │   ├── TerrainGenerator.ts # Procedural terrain generation
│   │   ├── ChunkPipeline.ts # Chunk loading pipeline
│   │   ├── chunk/          # Chunk data structures
│   │   └── blocks/         # Block registry and definitions
│   ├── audio/              # Audio systems
│   │   └── SoundEffects.ts # 3D spatial audio
│   ├── workers/            # Web Workers
│   │   ├── generator.worker.ts # Terrain generation worker
│   │   └── mesher.worker.ts    # Mesh generation worker
│   └── utils/              # Utilities and helpers
├── assets/                 # Game assets
│   ├── textures/           # Block and entity textures
│   ├── sounds/             # Audio files
│   │   ├── music/          # Background music
│   │   └── sound_effects/  # Game sound effects
│   └── material_icons/     # UI icons
├── config/                 # Game configuration
│   ├── constants.ts        # Game constants and tuning
│   └── flags.ts            # Feature flags
├── state/                  # Zustand state management
├── types/                  # TypeScript type definitions
└── shared/                 # Shared utilities
```

## 🧪 Development

### Available Scripts

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run preview    # Preview production build
npm run test       # Run test suite
npm run test:run   # Run tests once
npm run typecheck  # Type checking
npm run lint       # Lint code
```

### Testing
The project includes comprehensive unit tests covering:
- Coordinate system mathematics
- World generation algorithms  
- Block registry functionality
- Chunk data structures
- Collision detection systems

Run tests with:
```bash
npm test
```

### Graphics Settings
The engine supports advanced graphics configuration:
- **SSAO (Screen Space Ambient Occlusion)**: Adds realistic shadows in crevices
- **Bloom**: Adds light bleeding effects for bright surfaces
- **Volumetric Lighting**: Creates atmospheric light shafts
- **Dynamic Shadows**: Real-time shadow mapping with multiple cascades
- **Fog**: Distance-based atmospheric fog
- **Cloud Shadows**: Dynamic cloud shadow projection

### Performance Optimization
- **Web Workers**: Terrain generation and meshing run off the main thread
- **Frustum Culling**: Only visible chunks are rendered
- **Face Culling**: Hidden block faces are not rendered
- **Geometry Instancing**: Efficient rendering of repeated elements
- **Memory Management**: Automatic cleanup of distant chunks

## 🏗️ Architecture

### Core Systems

1. **Engine Core**: Main game loop, system coordination, and lifecycle management
2. **World System**: Procedural generation, chunk management, and world state
3. **Rendering System**: Graphics pipeline, materials, lighting, and post-processing
4. **Physics System**: Collision detection, player movement, and water physics
5. **Audio System**: 3D spatial audio, environmental sounds, and music
6. **Input System**: Mouse and keyboard handling with pointer lock
7. **UI System**: React-based interface with Zustand state management

### Data Flow
```
User Input → Input System → Player Controller → Physics → World Updates
                ↓
          Chunk Pipeline → Web Workers → Mesh Generation → Rendering
                ↓
          Audio System ← World State → UI Updates
```

## 🎨 Block Types

| Block | ID | Description | Properties |
|-------|----|-----------|----|
| **Air** | 0 | Empty space | Non-solid, transparent |
| **Grass** | 1 | Grass blocks with dirt base | Solid, different textures per face |
| **Dirt** | 2 | Basic earth material | Solid, uniform texture |
| **Stone** | 3 | Rock and cobblestone | Solid, uniform texture |
| **Sand** | 4 | Desert/beach material | Solid, uniform texture |
| **Water** | 5 | Liquid water | Non-solid, transparent, special rendering |
| **Wood** | 6 | Tree trunk material | Solid, directional textures |
| **Leaves** | 7 | Tree foliage | Solid, semi-transparent |
| **Maple Leaves** | 8 | Autumn tree foliage | Solid, colored variant |
| **Grass Tuft** | 9 | Decorative plant | Non-solid, billboard rendering |

## 🌊 Technical Deep Dive

### World Generation Algorithm
MyCraft uses a sophisticated multi-layered noise system:

1. **Island Shape**: Uses distance-based falloff with coastal noise variation
2. **Base Elevation**: Large-scale terrain elevation using simplex noise
3. **Hills and Valleys**: Mid-scale features with multiple octaves
4. **Fine Detail**: Small-scale surface variations
5. **Lake Generation**: Depression-based water feature creation
6. **Ocean Floor**: Gradient-based underwater terrain

### Rendering Pipeline
The engine employs a modern deferred-like rendering approach:

1. **Geometry Pass**: Renders all opaque geometry with materials
2. **Shadow Pass**: Generates shadow maps for dynamic lighting
3. **Lighting Pass**: Applies sun lighting and atmospheric effects
4. **Post-Processing**: Applies SSAO, bloom, fog, and other effects
5. **Transparent Pass**: Renders water and other transparent materials
6. **UI Overlay**: Renders game interface elements

### Water System
Advanced water rendering includes:
- **Surface waves**: Animated water surface with normal perturbation
- **Refraction**: Simulated light bending through water
- **Ocean horizon**: Seamless infinite ocean extending to the horizon
- **Underwater effects**: Color filtering and particle effects
- **Physics**: Realistic swimming and water collision

## 📊 Performance Metrics

The engine is optimized for smooth 60 FPS gameplay with:
- **Chunk Streaming**: ~6 chunk radius (1.4k block radius)
- **Triangle Budget**: <100k triangles typical
- **Memory Usage**: <500MB including textures and audio
- **Load Times**: <2s for initial world generation
- **Save Files**: <1MB for typical world states

## 🔧 Configuration

### Feature Flags (`src/config/flags.ts`)
```typescript
export const USE_EFFECT_COMPOSER = true;    // Advanced post-processing
export const USE_OCEAN_HORIZON = true;      // Infinite ocean rendering
export const CHUNK_RADIUS = 6;              // World streaming radius
export const USE_WORKERS = true;            // Web Worker utilization
```

### Constants (`src/config/constants.ts`)
```typescript
export const CHUNK_SIZE = { x: 48, y: 96, z: 48 };  // Chunk dimensions
export const PLAYER = {
  height: 1.8,           // Player height in blocks
  speed: { walk: 4, sprint: 6 },  // Movement speeds
  jump: 8,               // Jump velocity
  gravity: -24           // Gravity acceleration
};
```

## 🎵 Audio Assets

### Music
- **Blessed.mp3**: Ambient background music for exploration

### Sound Effects
- **footstep.mp3**: Player footstep sounds
- **water_step.mp3**: Walking through water
- **underwater.mp3**: Underwater ambient audio
- **ocean.mp3**: Ocean wave sounds
- **block.mp3**: Block placement/mining sounds
- **swing.mp3**: Tool swinging audio