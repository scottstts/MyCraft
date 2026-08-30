/**
 * Coalesces browser resize notifications into one renderer commit per frame.
 * The commit callback decides whether the current viewport is valid; this
 * keeps transient zero-sized layouts from resizing GPU resources.
 */
export class ResizeCoordinator {
  private frameId: number | null = null;
  private readonly commit: () => void;

  private readonly schedule = (): void => {
    if (this.frameId !== null) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      this.commit();
    });
  };

  constructor(commit: () => void) {
    this.commit = commit;
    window.addEventListener('resize', this.schedule);
  }

  dispose(): void {
    window.removeEventListener('resize', this.schedule);
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }
}
