import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/ai-town',
  plugins: [react()],
  server: {
    allowedHosts: ['ai-town-your-app-name.fly.dev', 'localhost', '127.0.0.1'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  build: {
    rollupOptions: {
      external: ['@reown/appkit-scaffold-ui/w3m-modal'],
    },
  },
  resolve: {
    alias: {
      '@reown/appkit-scaffold-ui/w3m-modal': '@reown/appkit-scaffold-ui',
    },
    dedupe: ['viem', 'wagmi', '@wagmi/core'],
  },
  optimizeDeps: {
    exclude: ['@base-org/account'],
  },
});
