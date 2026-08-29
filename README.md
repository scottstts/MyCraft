# MyCraft - Internal Documentation

MyCraft is a browser-based Minecraft-like voxel block building game built with React, Three.js, and TypeScript. This README serves as comprehensive internal documentation for understanding the codebase architecture, systems, and development workflow.

## Table of Contents

- [Project Overview](#project-overview)
- [Architecture](#architecture)
- [Core Systems](#core-systems)
- [Directory Structure](#directory-structure)
- [Technology Stack](#technology-stack)
- [State Management](#state-management)
- [Game Engine](#game-engine)
- [Rendering Pipeline](#rendering-pipeline)
- [Data Models & Types](#data-models--types)
- [Configuration](#configuration)
- [Build System](#build-system)
- [Testing](#testing)
- [Development Workflow](#development-workflow)

## Project Overview

**Name**: `minecraft_clone`  
**Version**: 0.0.0  
**Type**: ES Module  
**Framework**: React 19.1.1 with TypeScript  
**Engine**: Three.js 0.179.1 with custom game engine  

MyCraft implements a complete 3D voxel world with procedural terrain generation, physics simulation, real-time lighting, post-processing effects, and a full UI system for block building and world management.

## Architecture

The application follows a **hybrid architecture** combining:

1. **React-based UI layer** for menus, HUD, and user interface
2. **Pure TypeScript game engine** with no React dependencies  
3. **Web Workers** for terrain generation and mesh processing
4. **Zustand state management** bridging React and engine components

### Key Architectural Principles

- **Separation of Concerns**: Engine code is pure TS with no React imports
- **Module Isolation**: Each system has clear boundaries and interfaces  
- **Performance-First**: Critical paths use direct APIs, avoid React overhead
- **Type Safety**: Comprehensive TypeScript types across all systems
- **Immutable State**: All state updates follow immutable patterns

## Core Systems

### Game Engine (`src/engine/core/Engine.ts`)
The main game engine orchestrates all subsystems:
- **RAF Loop**: 60fps rendering with delta time management
- **Subsystem Management**: Coordinates renderer, world, physics, input
- **State Integration**: Bridges engine state with React UI state
- **Performance Monitoring**: FPS tracking and optimization

### World System (`src/engine/world/`)
- **Chunk-based infinite world** with 48x96x48 block chunks
- **Procedural generation** using Simplex noise and island algorithms
- **Multi-threaded processing** with Web Workers for generation and meshing
- **Save/Load system** with encryption and digital signatures
- **Block registry** with 20+ different block types

### Rendering Pipeline (`src/engine/render/`)
- **Three.js WebGL renderer** with custom materials and shaders
- **Authored post-processing** including aerial perspective, fixed exposure, bloom, and lens flare
- **Dynamic lighting** with a fixed 10-minute day / 10-minute night cycle and voxel sun visibility
- **Atmospheric effects** including an analytic Rayleigh/Mie sky, solar/lunar discs, and stars
- **Water rendering** with reflections, refractions, and horizon effects

### Physics & Interaction (`src/engine/systems/`)
- **Player controller** with gravity, jumping, swimming mechanics
- **Block interaction** system for mining and placing blocks  
- **Collision detection** using AABB collision with the voxel world
- **Input handling** with pointer lock for FPS-style camera control

## Directory Structure

```
MyCraft/
├── public/                 # Static assets (textures, sounds, icons)
├── src/
│   ├── app/               # React UI components
│   │   ├── AudioPanel.tsx      # Audio control interface
│   │   ├── CanvasHost.tsx      # Three.js canvas container
│   │   ├── DebugPanel.tsx      # Developer debug tools
│   │   ├── Hotbar.tsx          # Minecraft-style inventory bar
│   │   ├── LoadingOverlay.tsx  # Loading screens
│   │   ├── MusicController.tsx # Background music system
│   │   └── StartPanel.tsx      # Main menu and world loading
│   ├── assets/            # Game assets organized by type
│   │   ├── material_icons/     # UI icons
│   │   ├── sounds/             # Audio files (footsteps, water, etc)
│   │   └── textures/           # Block textures and materials
│   ├── config/            # Configuration and constants
│   │   ├── constants.ts        # Game constants (player speed, chunk size)
│   │   └── flags.ts           # Feature flags for development
│   ├── engine/            # Pure TypeScript game engine
│   │   ├── audio/             # Sound effects system
│   │   ├── core/              # Main engine and game loop
│   │   ├── render/            # Rendering, materials, post-processing
│   │   ├── systems/           # Input, physics, interaction systems
│   │   ├── utils/             # Math utilities and helpers
│   │   ├── workers/           # Web Workers for terrain/meshing
│   │   └── world/             # World generation and chunk management
│   ├── shared/            # Utilities shared between engine and UI
│   ├── state/             # Zustand state management
│   │   ├── inventory.ts       # Player inventory management
│   │   └── ui.ts              # UI state and game controls
│   └── types/             # TypeScript type definitions
├── tests/                 # Vitest test files
├── docs/                  # Additional documentation
└── dist/                  # Built application (generated)
```

## Technology Stack

### Frontend Framework
- **React 19.1.1** - UI components and DOM management
- **TypeScript 5.8.3** - Type safety and development tooling
- **Vite 7.1.2** - Build tool and development server

### 3D Graphics & Game Engine
- **Three.js 0.179.1** - WebGL rendering and 3D scene management  
- **Custom Shaders** - GLSL shaders for materials and post-processing
- **Web Workers** - Multi-threaded terrain generation and mesh processing

### State Management
- **Zustand 5.0.8** - Lightweight state management with hooks and direct API

### Utilities
- **Simplex Noise 4.0.3** - Procedural terrain generation
- **IndexedDB (idb-keyval 6.2.2)** - Browser storage for saves
- **Web Crypto API** - Save file encryption and digital signatures

### Development Tools
- **ESLint 9.33.0** - Code linting with TypeScript rules
- **Vitest 3.2.4** - Unit testing framework
- **TypeScript ESLint** - Advanced TypeScript linting rules

## State Management

### Zustand Architecture
The application uses **two primary Zustand stores**:

#### UI Store (`src/state/ui.ts`)
Manages game controls and interface state:
```typescript
interface UIState {
  selectedSlot: number;        // Current hotbar slot (0-8)
  hotbar: number[];           // Array of 9 block IDs  
  fps: number;                // Engine-reported FPS
  paused: boolean;            // Game pause state
  inGame: boolean;            // Focus control state
  debugVisible: boolean;      // Debug panel visibility
  audioVisible: boolean;      // Audio panel visibility
  gameStarted: boolean;       // Controls start panel
  chunkCount: number;         // World size (default 9 chunks)
  loading: boolean;           // Loading operations
  // ... actions
}
```

#### Inventory Store (`src/state/inventory.ts`)
Manages Minecraft-style inventory with 9 hotbar slots:
```typescript
interface InventoryState {
  slots: Slot[];              // Array of 9 inventory slots
  add(blockId, amount): void; // Add items to inventory
  consumeFromSelected(): void; // Use items from selected slot
  // ... additional actions
}
```

### State Flow Patterns
1. **React � State**: Components use Zustand hooks for reactive updates
2. **Engine � State**: Engine calls `getState()` for direct, non-reactive access
3. **Cross-Store**: Inventory reads selected slot from UI store
4. **Persistence**: Both stores integrate with save/load system

## Game Engine

### Engine Lifecycle (`src/engine/core/Engine.ts`)
The engine follows a standard game loop pattern:

```typescript
// Engine initialization
await start(canvas) � Initialize all subsystems
tick(timestamp) � RAF game loop
update(deltaTime) � Update all systems  
render() � Draw frame
stop() � Cleanup and dispose resources
```

### Subsystems Overview

#### World System (`src/engine/world/World.ts`)
- **Chunk Pipeline**: Manages generation � meshing � rendering pipeline
- **Terrain Generator**: Creates realistic island terrain with biomes
- **Block Registry**: Defines properties of all 20+ block types
- **Save System**: Handles world serialization with encryption

#### Rendering System (`src/engine/render/Renderer.ts`)
- **Scene Builder**: Constructs Three.js scene with lighting
- **Material System**: Custom block materials with atlas texturing  
- **Post-Processing**: Fixed scene-linear pipeline with aerial perspective, fixed exposure, bloom, lens flare, and output mapping
- **Atmospheric Rendering**: Analytic Rayleigh/Mie sky, solar/lunar discs, and deterministic stars

#### Input System (`src/engine/systems/Input.ts`)
- **Pointer Lock API** for FPS camera control
- **Keyboard Input** with configurable key bindings
- **Mouse Look** with sensitivity settings
- **Action Mapping** (WASD movement, space jump, click interactions)

#### Physics System (`src/engine/systems/PlayerController.ts`)
- **AABB Collision** detection against voxel world
- **Gravity Simulation** with realistic falling physics
- **Swimming Mechanics** with buoyancy and fluid dynamics  
- **Movement States** (walking, sprinting, jumping, swimming)

## Rendering Pipeline

### Multi-Pass Rendering
The engine uses one authored WebGL composer. Rendering stays scene-linear until
the final `OutputPass` applies the display transform:

1. **Geometry Pass**: Render terrain, water, grass, and the analytic sky
2. **Aerial Perspective Pass**: Depth-aware distance scattering using the shared atmosphere state
3. **Bloom Pass**: Subtle HDR highlight bloom
4. **Lens Flare Pass**: Restrained sun flare
5. **Output Pass**: Single AgX tone map and sRGB conversion with fixed renderer exposure

Voxel sun visibility remains the sole terrain-shadow authority; its occupancy
volume and screen-space reconstruction are kept separate from the sky pipeline.

### Material System
- **Block Material**: Atlas-based texturing with lighting and shadows
- **Water Material**: Animated water with reflections and refractions  
- **Grass Material**: Instanced billboards with wind animation
- **Sky Materials**: Physically-based sky dome and star field

### Dynamic Lighting
- **Sun Controller**: Fixed 10-minute day / 10-minute night cycle
- **Shadow System**: Voxel occupancy and screen-space visibility (no second native shadow map)
- **Ambient Lighting**: Time-of-day based ambient light levels
- **Atmosphere Model**: Shared sky, sun, ambient, and distance-scattering state

## Data Models & Types

### Core Types (`src/types/index.ts`)
```typescript
type BlockId = number;                    // 0-255, 0 = AIR
type ChunkKey = string;                   // "${cx},${cy},${cz}"
interface V3i { x: number; y: number; z: number; } // Integer positions
interface V3f { x: number; y: number; z: number; } // Float positions
interface ChunkData { size: V3i; voxels: Uint8Array; }
interface BlockDef { id: BlockId; name: string; opaque: boolean; solid: boolean; faces: {...}; }
```

### Worker Communication (`src/types/workers.ts`)
```typescript
interface GenerateChunkRequest { type: 'GEN_CHUNK'; payload: {...}; }
interface MeshChunkRequest { type: 'MESH_CHUNK'; payload: {...}; }
interface ChunkDataResponse { type: 'CHUNK_DATA'; payload: ChunkData; }
interface ChunkMeshResponse { type: 'CHUNK_MESH'; payload: { opaque: MeshBuffers; transparent: MeshBuffers; }; }
```

### Save System (`src/types/save.ts`)
```typescript
interface WorldSaveFile {
  kind: 'MyCraftWorld';
  version: 2;
  encAlg: string;           // Encryption algorithm
  ivB64: string;            // Base64 initialization vector
  cipherB64: string;        // Encrypted world data
  signatureAlg: string;     // Digital signature algorithm
  signatureB64: string;     // Cryptographic signature
  publicKeyId: string;      // Key identifier
}
```

## Configuration

### Constants (`src/config/constants.ts`)
```typescript
CHUNK_SIZE = { x: 48, y: 96, z: 48 }     // Large chunks for performance
PLAYER = {
  height: 1.8, width: 0.6,              // Player dimensions  
  speed: { walk: 4, sprint: 6 },        // Movement speeds
  jump: 8, gravity: -24,                // Jump and gravity
  swim: { /* detailed swimming physics */ }
}
SWING_CYCLE_SECONDS = 0.2667             // Animation timing
INTERACTION.reach = 5                    // Block interaction distance
```

### Feature Flags (`src/config/flags.ts`)
```typescript
USE_WORKERS = true                       // Enable Web Workers
USE_GREEDY_MESH = false                  // Mesh optimization (WIP)
USE_OCEAN_HORIZON = true                 // Far ocean rendering
ENABLE_NOCLIP = false                    // Debug flying mode
CHUNK_RADIUS = 6                         // World generation radius
```

Authored rendering values live in `src/engine/render/settings/RenderStyle.ts`;
they are intentionally not exposed as player-facing tuning controls.

## Build System

### Vite Configuration (`vite.config.ts`)
- **React Plugin**: JSX transformation and React optimizations
- **TypeScript**: Full TypeScript compilation with strict mode
- **Vitest Integration**: Unit test configuration with globals
- **Asset Handling**: PNG assets included in bundle
- **Development Server**: Hot reload with WebGL support

### TypeScript Configuration
- **App Config** (`tsconfig.app.json`): Strict type checking, React JSX
- **Node Config** (`tsconfig.node.json`): Build tool configuration
- **Target**: ES2022 with DOM APIs for modern browser features

### ESLint Configuration (`eslint.config.js`)
- **TypeScript ESLint**: Comprehensive TypeScript linting
- **React Hooks**: Enforces React Hooks rules
- **React Refresh**: Vite fast refresh compatibility
- **Browser Globals**: Web API globals for browser environment

## Testing

### Vitest Configuration
- **Framework**: Vitest 3.2.4 with Node.js test environment
- **Test Location**: `tests/**/*.spec.ts` files
- **Globals**: Enabled for describe/it/expect without imports
- **Coverage**: Available via `npm run test` command

### NPM Scripts
```json
{
  "dev": "vite",                    // Development server
  "build": "tsc -b && vite build", // Production build
  "lint": "eslint .",               // Code linting
  "preview": "vite preview",        // Preview built app
  "test": "vitest",                 // Interactive tests  
  "test:run": "vitest run",         // Single test run
  "typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.node.json --noEmit"
}
```

## Development Workflow

### Local camera diagnostics

The render pipeline can be captured from deterministic camera poses while
running locally:

```
http://localhost:5173/?debug=1&view=overview
http://localhost:5173/?debug=1&view=player-spawn
http://localhost:5173/?debug=1&view=player-ridge
http://localhost:5173/?debug=1&view=player-gully
```

The route is accepted only for loopback hostnames (`localhost`, `127.0.0.1`,
or `::1`); deployed hosts fall through to the normal game. Each view uses the
same `createPlayerCamera` factory, `Engine` renderer, materials, shadows, and
post-processing as gameplay. Only the world-space pose changes.

### Getting Started
1. `npm install` - Install dependencies
2. `npm run dev` - Start development server
3. Navigate to `http://localhost:5173`
4. `npm run typecheck` - Verify TypeScript compilation
5. `npm run lint` - Check code style
6. `npm run test` - Run tests

### Code Organization Principles
1. **Pure Engine Code**: No React imports in `/engine` directory
2. **Type Safety**: Comprehensive TypeScript types for all interfaces
3. **Immutable Updates**: All state changes use immutable patterns  
4. **Performance Critical**: Direct APIs for engine, hooks for UI
5. **Module Boundaries**: Clear interfaces between subsystems

### Key Files for Modification
- `src/engine/core/Engine.ts` - Main game loop and subsystem coordination
- `src/engine/world/TerrainGenerator.ts` - Procedural world generation
- `src/engine/render/BlockMaterial.ts` - Block rendering and shaders
- `src/state/` - Application state management  
- `src/app/` - React UI components
- `src/config/constants.ts` - Game balance and tuning parameters

### Architecture Guidelines
1. **Separation**: Keep engine and UI code separate
2. **Types**: Define interfaces before implementation
3. **Performance**: Profile before optimizing, measure impact
4. **State**: Use Zustand stores for shared state
5. **Workers**: Offload heavy computation to Web Workers
6. **Assets**: Organize textures and sounds by functionality

---

This documentation provides a comprehensive overview of the MyCraft codebase. For specific implementation details, refer to the inline code comments and TypeScript type definitions throughout the source code.
