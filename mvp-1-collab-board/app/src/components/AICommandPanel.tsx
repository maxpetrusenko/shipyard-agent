import { useState } from 'react'

type AICommandPanelProps = {
  disabled: boolean
  onSubmit: (command: string) => Promise<void>
}

export const AICommandPanel = ({ disabled, onSubmit }: AICommandPanelProps) => {
  const [command, setCommand] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const handleSubmit = async () => {
    const trimmed = command.trim()
    if (!trimmed || disabled) {
      return
    }

    setStatus('running')
    try {
      await onSubmit(trimmed)
      setStatus('success')
      setMessage('Command captured. Wire Cloud Function to execute this plan.')
      setCommand('')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Failed to submit command')
    }
  }

  return (
    <aside className="ai-panel">
      <div className="ai-panel-header">
        <h3>AI Command Panel</h3>
        <span className={`status-pill ${status}`}>{status}</span>
      </div>
      <textarea
        className="ai-input"
        placeholder="Create a SWOT template with four quadrants"
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void handleSubmit()
          }
        }}
      />
      <button type="button" className="primary-button" onClick={() => void handleSubmit()} disabled={disabled}>
        Send Command
      </button>
      {message && <p className="panel-note">{message}</p>}
      <p className="panel-note">
        MVP includes the UI contract now. Backend tool execution should call the server dispatcher.
      </p>
    </aside>
  )
}
