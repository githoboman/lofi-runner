import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

function isExtensionError(value: unknown, filename?: string): boolean {
  const text =
    value instanceof Error
      ? `${value.message}\n${value.stack ?? ''}`
      : `${String(value ?? '')}\n${filename ?? ''}`;
  return (
    text.includes('chrome-extension://') ||
    text.includes('moz-extension://') ||
    text.includes('safari-extension://') ||
    text.includes('Failed to connect to MetaMask')
  );
}

window.addEventListener(
  'unhandledrejection',
  (event) => {
    if (isExtensionError(event.reason)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

window.addEventListener(
  'error',
  (event) => {
    if (isExtensionError(event.error ?? event.message, event.filename)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },
  true,
);

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error?.message || 'Unexpected error occurred.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application ErrorBoundary:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full items-center justify-center bg-[#090d16] p-6 text-center text-slate-100">
          <div className="max-w-sm rounded-2xl border border-white/14 bg-[#0d1424] p-6 shadow-2xl">
            <h1 className="font-[var(--font-display)] text-xl font-bold text-white">
              Something went wrong
            </h1>
            <p className="mt-2 text-xs text-slate-300">
              Please reload the page to continue running.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 w-full rounded-xl bg-sky-400 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-300 cursor-pointer"
            >
              Reload Game
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
