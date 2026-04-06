import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

const App = lazy(() => import("./App"));

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
    <div className="flex h-screen w-full items-center justify-center bg-slate-950 text-slate-400">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
        <p className="text-sm">載入中...</p>
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
