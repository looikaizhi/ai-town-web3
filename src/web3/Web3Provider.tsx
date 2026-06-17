import '@rainbow-me/rainbowkit/styles.css';
import { ReactNode, useRef } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from './wagmi';

export function Web3Provider({ children }: { children: ReactNode }) {
  // useRef ensures a single QueryClient per mount, surviving StrictMode double-invoke
  const queryClientRef = useRef<QueryClient | null>(null);
  if (!queryClientRef.current) queryClientRef.current = new QueryClient();

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClientRef.current}>
        <RainbowKitProvider theme={darkTheme({ accentColor: '#22C55E', borderRadius: 'none' })}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
