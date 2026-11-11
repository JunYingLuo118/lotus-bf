import { Component } from 'react'

// Error boundaries still have to be class components: function components cannot catch render errors.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('LoTUS-BF crashed:', error, info?.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="mx-auto mt-16 max-w-xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-rose-700">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">
          The page hit an unexpected error. Reloading usually fixes it, and your query is kept in the address bar.
        </p>
        <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-slate-50 p-3 text-xs whitespace-pre-wrap text-slate-500">
          {String(error?.message || error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-lotus-600 px-4 py-2 text-sm font-medium text-white hover:bg-lotus-700"
        >
          Reload
        </button>
      </div>
    )
  }
}
