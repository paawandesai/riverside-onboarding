import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { DraftProvider } from "./draft";

export function makeQueryClient() {
  // In memory only: no persistence plugin, so nothing personal reaches browser storage.
  return new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false }, mutations: { retry: false } } });
}

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? makeQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <DraftProvider>{children}</DraftProvider>
    </QueryClientProvider>
  );
}
