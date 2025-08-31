import { useUIStore } from '../state/ui'

export function ClickToEnterOverlay() {
  const gameStarted = useUIStore(s => s.gameStarted)
  const inGame = useUIStore(s => s.inGame)

  if (!gameStarted || inGame) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.5)',
      color: '#ffffff',
      fontSize: '24px',
      fontWeight: 'bold',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: 1000
    }}>
      Click to Enter
    </div>
  )
}

export default ClickToEnterOverlay