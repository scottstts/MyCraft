// no React import needed with react-jsx runtime
import { useUIStore } from '../state/ui'

export function SaveWorldButton() {
  const setLoading = useUIStore(s => s.setLoading)
  const gameStarted = useUIStore(s => s.gameStarted)
  if (!gameStarted) return null

  return (
    <button
      onClick={async () => { 
        setLoading(true)
        try {
          // Minimal structural types to avoid explicit any
          type SaveFilePickerOptions = {
            suggestedName?: string
            types?: Array<{ description?: string; accept: Record<string, string[]> }>
            excludeAcceptAllOption?: boolean
          }
          type FileSystemFileHandleLike = {
            createWritable: () => Promise<{ write(data: Blob | BufferSource | string): Promise<void>; close(): Promise<void> }>
          }
          // Step 1: Ask the user where to save (when supported)
          const w = window as unknown as { showSaveFilePicker?: (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike> } & { __nextSaveFileHandle?: unknown };
          if (typeof w.showSaveFilePicker === 'function') {
            try {
              const suggestedName = `mycraft-world-${new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').replace('Z','')}.json`
              const handle = await w.showSaveFilePicker({
                suggestedName,
                types: [{ description: 'MyCraft World (JSON)', accept: { 'application/json': ['.json'] } }],
              })
              w.__nextSaveFileHandle = handle
            } catch (err: unknown) {
              const name = (err as { name?: string } | undefined)?.name
              if (name === 'AbortError' || name === 'NotAllowedError') {
                setLoading(false)
                return
              }
              console.warn('Save picker failed; falling back to default download.', err)
            }
          }

          // Step 2: Trigger the actual save (engine will use handle if provided)
          ;(window as Window & { __saveWorld?: () => void }).__saveWorld?.()
          // Add a small delay to show the loader
          await new Promise(resolve => setTimeout(resolve, 500))
        } catch (e) {
          console.error('Save failed:', e)
        } finally {
          setLoading(false)
        }
      }}
      style={{
        padding: '8px 12px',
        background: 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))',
        color: '#f8f9fa',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '12px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: 600,
        letterSpacing: 0.3,
        pointerEvents: 'auto',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        width: 'fit-content',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 8px 32px rgba(147,51,234,0.4), 0 4px 16px rgba(0,0,0,0.4)'
        e.currentTarget.style.borderColor = 'rgba(147,51,234,0.4)'
        e.currentTarget.style.background = 'linear-gradient(145deg, rgba(42,49,59,0.98), rgba(32,37,45,0.98))'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
        e.currentTarget.style.background = 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginRight: '6px', flexShrink: 0 }}>
        <path d="M17 3H7a2 2 0 00-2 2v14l7-3 7 3V5a2 2 0 00-2-2z" fill="currentColor" opacity="0.8"/>
      </svg>
      Save World
    </button>
  )
}

export default SaveWorldButton
