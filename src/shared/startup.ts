export const BOOT_STAGE_LABELS = {
  'engine-import': 'Loading the game engine',
  renderer: 'Initializing graphics',
  scene: 'Building the world view',
  world: 'Creating the world model',
  assets: 'Loading world assets',
  'render-pipeline': 'Preparing the render pipeline',
  systems: 'Connecting game systems',
  'world-loading': 'Generating the starting area',
  'shader-compilation': 'Compiling graphics shaders',
  warmup: 'Warming up the first frame',
  'first-render': 'Rendering the first frame',
  ready: 'Ready',
} as const;

export type BootStage = keyof typeof BOOT_STAGE_LABELS;

export interface StartupEnvironment {
  viewport: { width: number; height: number };
  dpr: number;
  platform: string;
}

export interface StartupErrorInfo extends StartupEnvironment {
  stage: BootStage;
  stageLabel: string;
  name: string;
  message: string;
  stack?: string;
}

export function getStartupEnvironment(): StartupEnvironment {
  const viewport = typeof window === 'undefined'
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };
  const dpr = typeof window === 'undefined' || !Number.isFinite(window.devicePixelRatio)
    ? 1
    : window.devicePixelRatio;
  const platform = typeof navigator === 'undefined'
    ? 'unknown'
    : navigator.userAgent || navigator.platform || 'unknown';

  return { viewport, dpr, platform };
}

function describeUnknownError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || 'Unknown startup error',
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }

  if (typeof error === 'string') {
    return { name: 'Error', message: error };
  }

  try {
    const serialized = JSON.stringify(error);
    return { name: 'Error', message: serialized || 'Unknown startup error' };
  } catch {
    return { name: 'Error', message: 'Unknown startup error' };
  }
}

export function createStartupError(
  stage: BootStage,
  error: unknown,
  overrides: Partial<StartupEnvironment> = {},
): StartupErrorInfo {
  const environment = getStartupEnvironment();
  const description = describeUnknownError(error);
  return {
    ...environment,
    ...overrides,
    stage,
    stageLabel: BOOT_STAGE_LABELS[stage],
    ...description,
  };
}

export function isStartupErrorInfo(error: unknown): error is StartupErrorInfo {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Partial<StartupErrorInfo>;
  return typeof candidate.stage === 'string'
    && typeof candidate.stageLabel === 'string'
    && typeof candidate.message === 'string'
    && !!candidate.viewport
    && typeof candidate.dpr === 'number';
}
