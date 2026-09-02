import * as THREE from 'three'
import {
  ConservativeRefractionSourceCuller,
  FORWARD_REFRACTION_LAYER,
  ForwardRefractionParticipantRegistry,
  forwardRefractionUniforms,
  setForwardRefractionActive,
  setForwardRefractionCamera,
  setForwardRefractionOutputReceiver,
  setForwardRefractionReceiverTexture,
  setForwardRefractionResolution,
  FORWARD_REFRACTION_MEDIUM,
  FORWARD_REFRACTION_RECEIVER_MATERIAL,
  FORWARD_REFRACTION_COLOR_MATERIAL,
} from './ForwardRefraction'
import type { RenderStageProfiler } from '../RenderStageProfiler.js'
import type { ForwardRefractionMedium } from '../../world/ForwardRefractionMeshing.js'

interface RenderableState {
  object: THREE.Mesh | THREE.Line | THREE.Points
  visible: boolean
  frustumCulled: boolean
  bounds: THREE.Box3
}

interface ForwardMaterialState {
  object: THREE.Mesh | THREE.Line | THREE.Points
  material: THREE.Material | THREE.Material[]
}

/**
 * Renders opposite-medium geometry after its vertices have been transported
 * through the live water interface. The target is an apparent-image layer:
 * RGB is premultiplied by transparent clear at coverage edges, alpha is
 * coverage, and depth is the projected source radial distance.
 */
export class ForwardRefractionPass {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly target: THREE.WebGLRenderTarget
  private readonly receiverTarget: THREE.WebGLRenderTarget
  private readonly size = new THREE.Vector2()
  private readonly clearColor = new THREE.Color()
  private readonly renderableStates: RenderableState[] = []
  private activeRenderableStateCount = 0
  private readonly participants: ForwardRefractionParticipantRegistry
  private readonly sourceCuller = new ConservativeRefractionSourceCuller()
  private readonly stageProfiler?: RenderStageProfiler

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    width: number,
    height: number,
    participants?: ForwardRefractionParticipantRegistry,
    stageProfiler?: RenderStageProfiler,
  ) {
    this.renderer = renderer
    this.scene = scene
    this.participants = participants ?? new ForwardRefractionParticipantRegistry()
    this.stageProfiler = stageProfiler
    // The compatibility constructor remains useful to isolated callers. The
    // game supplies a shared registry and registers each render system at its
    // creation/rebuild boundary instead of paying this traversal per frame.
    if (!participants) this.participants.registerTree(scene)
    const depthTexture = new THREE.DepthTexture(
      Math.max(1, width),
      Math.max(1, height),
      THREE.UnsignedIntType,
    )
    depthTexture.format = THREE.DepthFormat
    depthTexture.minFilter = THREE.NearestFilter
    depthTexture.magFilter = THREE.NearestFilter

    this.target = new THREE.WebGLRenderTarget(
      Math.max(1, width),
      Math.max(1, height),
      {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        depthTexture,
      },
    )
    this.target.texture.colorSpace = THREE.NoColorSpace
    this.target.texture.generateMipmaps = false
    const receiverDepthTexture = new THREE.DepthTexture(
      Math.max(1, width),
      Math.max(1, height),
      THREE.UnsignedIntType,
    )
    receiverDepthTexture.format = THREE.DepthFormat
    receiverDepthTexture.minFilter = THREE.NearestFilter
    receiverDepthTexture.magFilter = THREE.NearestFilter
    this.receiverTarget = new THREE.WebGLRenderTarget(
      Math.max(1, width),
      Math.max(1, height),
      {
        // Receiver coordinates feed a world-space DDA and analytic character
        // intersection. RGB16F normalized over an 832-block world can move a
        // surface point by tenths of a block, which changes the starting cell.
        // Store direct world coordinates in RGB32F instead.
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        stencilBuffer: false,
        depthTexture: receiverDepthTexture,
      },
    )
    this.receiverTarget.texture.colorSpace = THREE.NoColorSpace
    this.receiverTarget.texture.generateMipmaps = false
    setForwardRefractionReceiverTexture(this.receiverTarget.texture)
    setForwardRefractionResolution(this.target.width, this.target.height)
  }

  getColorTexture(): THREE.Texture {
    return this.target.texture
  }

  getDepthTexture(): THREE.DepthTexture {
    return this.target.depthTexture as THREE.DepthTexture
  }

  getReceiverTexture(): THREE.Texture {
    return this.receiverTarget.texture
  }

  getReceiverDepthTexture(): THREE.DepthTexture {
    return this.receiverTarget.depthTexture as THREE.DepthTexture
  }

  getResolution(): { x: number; y: number } {
    return { x: this.target.width, y: this.target.height }
  }

  setSize(width: number, height: number): void {
    const nextWidth = Math.max(1, Math.floor(width))
    const nextHeight = Math.max(1, Math.floor(height))
    this.target.setSize(nextWidth, nextHeight)
    this.receiverTarget.setSize(nextWidth, nextHeight)
    setForwardRefractionResolution(nextWidth, nextHeight)
  }

  render(
    camera: THREE.PerspectiveCamera,
    resolveReceiverVisibility?: (
      receiverTexture: THREE.Texture,
      receiverDepth: THREE.DepthTexture,
    ) => void,
  ): void {
    setForwardRefractionCamera(camera)
    this.activeRenderableStateCount = 0

    const previousTarget = this.renderer.getRenderTarget()
    const previousAlpha = this.renderer.getClearAlpha()
    const previousBackground = this.scene.background
    const previousCameraLayers = camera.layers.mask
    this.renderer.getClearColor(this.clearColor)
    let previousForwardMaterials: ForwardMaterialState[] = []

    try {
      const cameraUnderwater = Boolean(forwardRefractionUniforms.uForwardCameraUnderwater.value)
      if (cameraUnderwater) {
        this.sourceCuller.update(
          camera,
          Number(forwardRefractionUniforms.uForwardWaterLevel.value),
        )
        // Water-to-air projection can pull an off-frustum source into the Snell
        // window. Only registered participants are tested, and only their
        // conservative source boxes have culling temporarily overridden.
        for (const object of this.participants.getParticipants()) {
          if (!object.visible) continue
          if (!this.isMediumVisible(object, cameraUnderwater)) {
            this.saveAndHide(object)
            continue
          }
          const state = this.renderableStates[this.activeRenderableStateCount] ?? {
            object,
            visible: true,
            frustumCulled: true,
            bounds: new THREE.Box3(),
          }
          this.renderableStates[this.activeRenderableStateCount] = state
          state.object = object
          state.visible = object.visible
          state.frustumCulled = object.frustumCulled
          object.updateWorldMatrix(true, false)
          const geometry = object.geometry as THREE.BufferGeometry
          // InstancedMesh keeps its aggregate bounds on the object; using the
          // shared base geometry bounds here would collapse every grass/seaweed
          // source to the first cell and could reject a valid refracted source.
          let localBounds: THREE.Box3 | null = null
          if (object instanceof THREE.InstancedMesh) {
            if (!object.boundingBox) object.computeBoundingBox()
            localBounds = object.boundingBox
          } else {
            if (!geometry.boundingBox) geometry.computeBoundingBox()
            localBounds = geometry.boundingBox
          }
          if (localBounds) {
            state.bounds.copy(localBounds).applyMatrix4(object.matrixWorld)
          } else {
            state.bounds.makeEmpty()
          }
          object.visible = this.sourceCuller.intersectsBox(state.bounds)
          object.frustumCulled = false
          this.activeRenderableStateCount += 1
        }
      } else {
        // Above-water views do not need source-box culling, but they still
        // benefit from rejecting the large, definitely-above terrain ranges.
        for (const object of this.participants.getParticipants()) {
          if (!object.visible || this.isMediumVisible(object, cameraUnderwater)) continue
          this.saveAndHide(object)
        }
      }

      this.scene.background = null
      camera.layers.set(FORWARD_REFRACTION_LAYER)
      setForwardRefractionActive(true)
      setForwardRefractionOutputReceiver(true)
      previousForwardMaterials = this.setForwardMaterialMode('receiver')
      // Do not leave the receiver sampler bound to the texture currently
      // attached for drawing, even though the receiver branch does not sample
      // it. WebGL feedback validation is attachment based.
      setForwardRefractionReceiverTexture(null)
      const renderReceiver = () => {
        this.renderer.setRenderTarget(this.receiverTarget)
        this.renderer.setClearColor(0x000000, 0)
        this.renderer.clear(true, true, false)
        this.renderer.render(this.scene, camera)
      }
      if (this.stageProfiler) this.stageProfiler.measure('forward-receiver-render', renderReceiver)
      else renderReceiver()

      resolveReceiverVisibility?.(
        this.receiverTarget.texture,
        this.receiverTarget.depthTexture as THREE.DepthTexture,
      )

      setForwardRefractionReceiverTexture(this.receiverTarget.texture)
      setForwardRefractionOutputReceiver(false)
      this.setForwardMaterialMode('color')
      const renderColor = () => {
        this.renderer.setRenderTarget(this.target)
        this.renderer.setClearColor(0x000000, 0)
        this.renderer.clear(true, true, false)
        this.renderer.render(this.scene, camera)
      }
      if (this.stageProfiler) this.stageProfiler.measure('forward-color-render', renderColor)
      else renderColor()
    } finally {
      setForwardRefractionOutputReceiver(false)
      setForwardRefractionActive(false)
      setForwardRefractionReceiverTexture(this.receiverTarget.texture)
      this.scene.background = previousBackground
      this.renderer.setRenderTarget(previousTarget)
      this.renderer.setClearColor(this.clearColor, previousAlpha)
      camera.layers.mask = previousCameraLayers
      for (let index = 0; index < this.activeRenderableStateCount; index += 1) {
        const state = this.renderableStates[index]
        state.object.visible = state.visible
        state.object.frustumCulled = state.frustumCulled
      }
      // Retain only the active prefix as a small state pool. This keeps stable
      // frames allocation-free without retaining meshes after a chunk/group
      // unregisters from the participant registry.
      this.renderableStates.length = this.activeRenderableStateCount
      this.activeRenderableStateCount = 0
      this.restoreForwardMaterials(previousForwardMaterials)
    }
  }

  getDiagnostics(): Record<string, unknown> {
    this.renderer.getDrawingBufferSize(this.size)
    return {
      width: this.target.width,
      height: this.target.height,
      drawingBufferWidth: this.size.x,
      drawingBufferHeight: this.size.y,
      projection: 'forward-fermat-snell',
      coverage: 'target-alpha',
      receiverSpace: 'source-world-rgb32f',
      participatingObjects: this.participants.size,
      sourceCulling: this.sourceCuller.getDiagnostics(),
      mediumSegregation: true,
    }
  }

  dispose(): void {
    setForwardRefractionReceiverTexture(null)
    this.participants.clear()
    this.renderableStates.length = 0
    this.target.dispose()
    this.receiverTarget.dispose()
  }

  private isMediumVisible(object: THREE.Object3D, cameraUnderwater: boolean): boolean {
    const medium = object.userData[FORWARD_REFRACTION_MEDIUM] as ForwardRefractionMedium | undefined
    if (!medium || medium === 'boundary') return true
    return cameraUnderwater ? medium === 'above' : medium === 'below'
  }

  private saveAndHide(object: THREE.Mesh | THREE.Line | THREE.Points): void {
    const state = this.renderableStates[this.activeRenderableStateCount] ?? {
      object,
      visible: true,
      frustumCulled: true,
      bounds: new THREE.Box3(),
    }
    this.renderableStates[this.activeRenderableStateCount] = state
    state.object = object
    state.visible = object.visible
    state.frustumCulled = object.frustumCulled
    object.visible = false
    object.frustumCulled = false
    this.activeRenderableStateCount += 1
  }

  private setForwardMaterialMode(mode: 'receiver' | 'color'): ForwardMaterialState[] {
    const previousMaterials: ForwardMaterialState[] = []
    for (const object of this.participants.getParticipants()) {
      const receiverMaterial = object.userData[FORWARD_REFRACTION_RECEIVER_MATERIAL] as
        THREE.Material | undefined
      const colorMaterial = object.userData[FORWARD_REFRACTION_COLOR_MATERIAL] as
        THREE.Material | undefined
      if (!receiverMaterial || !colorMaterial) continue
      if (mode === 'receiver') {
        previousMaterials.push({ object, material: object.material })
        object.material = receiverMaterial
      } else {
        object.material = colorMaterial
      }
    }
    return previousMaterials
  }

  private restoreForwardMaterials(states: ForwardMaterialState[]): void {
    for (const state of states) state.object.material = state.material
  }
}
