import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

const App = lazy(() => import("./App.tsx"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function LoadingFallback() {
  return (
    <div className="flex h-screen w-full items-center justify-center px-6" style={{ background: "var(--bg-app)" }}>
      <div className="card flex flex-col items-center gap-3 px-8 py-7 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[color:var(--border-strong)] border-t-[color:var(--accent)]" />
        <div>
          <p className="text-sm font-semibold text-[color:var(--text-primary)]">正在載入學習儀表板</p>
          <p className="mt-1 text-xs text-[color:var(--text-muted)]">同步課程、圖譜與複習資料中</p>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <ErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <App />
      </Suspense>
    </ErrorBoundary>
  </QueryClientProvider>,
);
