# Context

This repo is building **MyCraft**: a production-quality, WebGL 3D game in Three.js

Core principles:

- WebGL first-class
- Realistic-feeling physics: physics based graphics, no cheap graphics
- Minimal UI

**Must adhere:**

1. graphics will be high quality, this is non-negotiable
2. performance is secondary compared to graphics, but it must have playable fps (>20 fps) and no other issues like game freeze, stutter, etc

## Drawing-buffer and platform policy

The 4,000,000-pixel drawing-buffer limit is a hard cap. DPR may fall below 1
when the CSS viewport itself exceeds that budget; never restore a final
`Math.max(1, dpr)` floor, because that silently disables the cap on 4K desktop
viewports. Use the following base policy:

```typescript
const maxPixels = 1_600_000;
const width = Math.max(1, window.innerWidth);
const height = Math.max(1, window.innerHeight);

const dpr = Math.min(
  window.devicePixelRatio,
  1.7,
  Math.sqrt(maxPixels / (width * height))
);

renderer.setDrawingBufferSize(
  width,
  height,
  Number.isFinite(dpr) && dpr > 0 ? dpr : 1
);
```

If dynamic resolution is present, multiply this base DPR by the current render
scale before the single `setDrawingBufferSize()` call. Coalesce browser resize
events to one animation-frame commit, ignore transient 0x0 viewports, and never
call `setPixelRatio()` and `setSize()` separately for the same resize. These are
global correctness rules and must not visibly change an ordinary Mac viewport.
Backend-specific resource optimizations must remain isolated to the affected
platform and must not reduce rendering quality or add a lower-quality fallback.

## Boot and GPU failure handling

Treat the entire startup path—dynamic module import, renderer initialization,
system initialization, shader compilation, warmup, and first render—as one
observed promise chain with a terminal catch. Track the current boot stage and
surface failures through the project's existing entry/error UI with useful
stage, viewport, DPR, platform, and error diagnostics; never leave a frozen
loading screen or black canvas.

**Important:** DO NOT stuff everything in a generic GameRuntime.ts, over time it has become a monolithic code file. runtime should just be an entry point, if you need specific side logic, define it elsewhere and import into runtime code

# Rules

- there are threejs skills to use, you don't have to, but they contain some exceptional examples, the kind of examples that can achieve AAA grade graphics. so use them where appropriate
- if there are ambiguities or issues during building that you can't solve or you need to clarify, stop the job and ask me and report issues so i can help you (like installing packages, look for assets, etc.). DO NOT fall back to any inferior choices without asking me first!
- If you have any unresolved questions about standing ambiguities, seemingly contradicting instructions, seeming mistakes on my part, raise them and resolve them explicitly before proceeding to any implementation
- run lint and typecheck every time you finish a coding task to make sure code is clean
- don't run dev server for live browser visual inspection unless told otherwise
- do NOT commit code, I will do that myself
- Use WebGL throughout the build
- pay attention to relevant md docs in `docs/` dir, these can include intentions and design principles derived or surfaced during implementation beyond the code itself that are important for further implementing related features. Make sure you always update relevant docs in docs/ after new implementation to avoid stale and outdated references. During the initial implementation, add separate modular docs to document different parts of the game system
- When asked to write implementation documentations, do NOT include verbose and irrelevant things like broad project rules, what text was used, etc. The point of documentation for a specific session of implementation is to capture only design choices that were discussed or surfaced during coding beyond what code alone can tell that could potentially impact future implementations, not to repeat what the code or project rules already says
- When asked for plan or proposal for implementation, always plan for the ultimate state, do NOT plan or propose anything like "V1 fix for now and V2 for later", there is no later, there's only now
