import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-white p-6 rounded-xl shadow-lg border border-neutral-200 max-w-sm w-full">
            <span className="text-4xl block mb-4">⚠️</span>
            <h2 className="text-xl font-bold text-neutral-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-neutral-600 mb-6">
              The app encountered an unexpected error. Please restart the app.
            </p>
            <button
              onClick={() => window.location.href = '/'}
              className="w-full py-3 bg-forest-600 text-white font-bold rounded-lg"
            >
              Return Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
