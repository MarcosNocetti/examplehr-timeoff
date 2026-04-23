import React from 'react';

interface State { error: Error | null; }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface to the dev console for debugging
    // eslint-disable-next-line no-console
    console.error('UI error:', error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="bg-rose-50 border border-rose-300 rounded-md p-4 text-sm text-rose-900">
          <h3 className="font-semibold mb-2">Something went wrong rendering this page</h3>
          <p className="mb-2"><strong>{this.state.error.name}:</strong> {this.state.error.message}</p>
          <pre className="bg-rose-100 p-2 rounded text-xs overflow-auto max-h-64">
            {this.state.error.stack}
          </pre>
          <button
            onClick={this.reset}
            className="mt-3 bg-rose-700 text-white px-3 py-1 rounded text-xs"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
