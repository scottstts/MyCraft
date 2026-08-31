import { useRef } from 'react'
import { getWorldSizeOption, WORLD_SIZE_OPTIONS } from '../shared/worldSizes'
import './WorldSizePicker.css'

interface WorldSizePickerProps {
  value: number
  onChange: (chunkCount: number) => void
  disabled?: boolean
}

export function WorldSizePicker({ value, onChange, disabled = false }: WorldSizePickerProps) {
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([])
  const selectedOption = getWorldSizeOption(value) ?? WORLD_SIZE_OPTIONS[0]
  const selectedIndex = WORLD_SIZE_OPTIONS.findIndex((option) => option.id === selectedOption.id)

  const selectOption = (index: number) => {
    const option = WORLD_SIZE_OPTIONS[index]
    if (!option) return
    onChange(option.chunkCount)
    buttonsRef.current[index]?.focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % WORLD_SIZE_OPTIONS.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + WORLD_SIZE_OPTIONS.length) % WORLD_SIZE_OPTIONS.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = WORLD_SIZE_OPTIONS.length - 1
    }

    if (nextIndex === null) return
    event.preventDefault()
    selectOption(nextIndex)
  }

  return (
    <div className="world-size-picker" role="radiogroup" aria-label="World size">
      {WORLD_SIZE_OPTIONS.map((option, index) => {
        const selected = option.id === selectedOption.id
        // The preview is deliberately the same footprint as the label. Do
        // not compress larger worlds into a representative 5x5 icon.
        const previewSide = option.side
        const cellCount = previewSide * previewSide
        const centerCell = Math.floor(cellCount / 2)

        return (
          <button
            key={option.id}
            ref={(element) => { buttonsRef.current[index] = element }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${option.label}, ${option.side} by ${option.side} chunks`}
            tabIndex={index === selectedIndex ? 0 : -1}
            disabled={disabled}
            className={`world-size-picker__option${selected ? ' world-size-picker__option--selected' : ''}`}
            onClick={() => onChange(option.chunkCount)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="world-size-picker__topline">
              <span className="world-size-picker__name">{option.label}</span>
              <span className="world-size-picker__dimension">{option.side}×{option.side}</span>
            </span>
            <span
              className="world-size-picker__map"
              style={{ gridTemplateColumns: `repeat(${previewSide}, minmax(0, 1fr))` }}
              aria-hidden="true"
            >
              {Array.from({ length: cellCount }, (_, cellIndex) => (
                <span
                  key={`${option.id}-${cellIndex}`}
                  className={`world-size-picker__cell${cellIndex === centerCell ? ' world-size-picker__cell--center' : ''}`}
                />
              ))}
            </span>
            <span className="world-size-picker__meta">{option.chunkCount} chunks</span>
          </button>
        )
      })}
    </div>
  )
}

export default WorldSizePicker
