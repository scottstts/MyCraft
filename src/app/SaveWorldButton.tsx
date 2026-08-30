// no React import needed with react-jsx runtime
import { useUIStore } from '../state/ui'

export function SaveWorldButton() {
  const setLoading = useUIStore(s => s.setLoading)
  const gameStarted = useUIStore(s => s.gameStarted)
  const loading = useUIStore(s => s.loading)
  if (!gameStarted || loading) return null

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
        background: 'rgba(15, 23, 32, 0.94)',
        color: '#f8f9fa',
        border: '1px solid rgba(148,163,184,0.16)',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '12px',
        lineHeight: '16px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontWeight: 600,
        letterSpacing: 0.3,
        pointerEvents: 'auto',
        backdropFilter: 'blur(10px)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.28)',
        transition: 'all 0.2s ease',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: 'fit-content',
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 12px 26px rgba(0,0,0,0.34)'
        e.currentTarget.style.borderColor = 'rgba(94,234,212,0.38)'
        e.currentTarget.style.background = 'rgba(20, 31, 43, 0.98)'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.28)'
        e.currentTarget.style.borderColor = 'rgba(148,163,184,0.16)'
        e.currentTarget.style.background = 'rgba(15, 23, 32, 0.94)'
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ width: 14, height: 14, display: 'block', flexShrink: 0 }}>
        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor" opacity="0.8"/>
      </svg>
      <span>Save World</span>
    </button>
  )
}

export default SaveWorldButton
