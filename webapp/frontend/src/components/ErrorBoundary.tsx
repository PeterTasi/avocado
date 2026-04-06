import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: unknown) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: unknown) {
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-rose-800/50 bg-rose-950/40 p-6 text-center">
          <p className="text-sm font-semibold text-rose-300">載入失敗</p>
          <p className="mt-1 text-xs text-rose-400/70">
            {this.state.error?.message || "發生未知錯誤"}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 rounded-lg border border-rose-700/50 bg-rose-900/40 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-900/60"
          >
            重試
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
