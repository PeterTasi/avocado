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
    <div className="flex h-screen w-full items-center justify-center px-6 text-white/80">
      <div className="glass-panel flex flex-col items-center gap-3 rounded-[28px] px-8 py-7 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
        <div>
          <p className="text-sm font-semibold text-white">正在載入學習儀表板</p>
          <p className="mt-1 text-xs text-white/65">同步課程、圖譜與複習資料中</p>
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
