import * as THREE from 'three'
import {
  forwardRefractionUniforms,
  isForwardRefractionMaterial,
  setForwardRefractionActive,
  setForwardRefractionCamera,
  setForwardRefractionOutputReceiver,
  setForwardRefractionResolution,
} from './ForwardRefraction'

interface RenderableState {
  object: THREE.Object3D
  visible: boolean
  frustumCulled: boolean
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

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    width: number,
    height: number,
  ) {
    this.renderer = renderer
    this.scene = scene
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
        type: THREE.HalfFloatType,
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
    this.renderableStates.length = 0

    this.scene.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Line | THREE.Points
      const material = renderable.material
      if (!material) return
      const materials = Array.isArray(material) ? material : [material]
      const participates = materials.length > 0 &&
        materials.every((entry) => isForwardRefractionMaterial(entry))
      this.renderableStates.push({
        object,
        visible: object.visible,
        frustumCulled: object.frustumCulled,
      })
      if (!participates) object.visible = false
      // Water-to-air projection can pull an off-frustum source into the Snell
      // window, so submerged cameras use conservative uncropped proxies. In
      // air-to-water projection the apparent angle is larger than the source
      // angle; an on-screen transmitted source is already inside the direct
      // camera frustum, retaining chunk culling for the common above-water case.
      else if (
        object.visible &&
        forwardRefractionUniforms.uForwardCameraUnderwater.value
      ) {
        object.frustumCulled = false
      }
    })

    const previousTarget = this.renderer.getRenderTarget()
    const previousAlpha = this.renderer.getClearAlpha()
    const previousBackground = this.scene.background
    this.renderer.getClearColor(this.clearColor)
    try {
      this.scene.background = null
      setForwardRefractionActive(true)
      setForwardRefractionOutputReceiver(true)
      this.renderer.setRenderTarget(this.receiverTarget)
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.clear(true, true, false)
      this.renderer.render(this.scene, camera)

      resolveReceiverVisibility?.(
        this.receiverTarget.texture,
        this.receiverTarget.depthTexture as THREE.DepthTexture,
      )

      setForwardRefractionOutputReceiver(false)
      this.renderer.setRenderTarget(this.target)
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.clear(true, true, false)
      this.renderer.render(this.scene, camera)
    } finally {
      setForwardRefractionOutputReceiver(false)
      setForwardRefractionActive(false)
      this.scene.background = previousBackground
      this.renderer.setRenderTarget(previousTarget)
      this.renderer.setClearColor(this.clearColor, previousAlpha)
      for (const state of this.renderableStates) {
        state.object.visible = state.visible
        state.object.frustumCulled = state.frustumCulled
      }
      this.renderableStates.length = 0
    }
  }

  getDiagnostics(): Record<string, unknown> {
    this.renderer.getDrawingBufferSize(this.size)
    let participatingObjects = 0
    this.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material
      if (!material) return
      const materials = Array.isArray(material) ? material : [material]
      if (materials.length > 0 && materials.every(isForwardRefractionMaterial)) {
        participatingObjects += 1
      }
    })
    return {
      width: this.target.width,
      height: this.target.height,
      drawingBufferWidth: this.size.x,
      drawingBufferHeight: this.size.y,
      projection: 'forward-fermat-snell',
      coverage: 'target-alpha',
      receiverSpace: 'source-world-volume-normalized',
      participatingObjects,
    }
  }

  dispose(): void {
    this.target.dispose()
    this.receiverTarget.dispose()
  }
}
