import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the built site works from any folder or sub-path.
  base: './',
  build: {
    // pdfkit and pdf.js are both needed for the first preview, so splitting them off gains nothing.
    chunkSizeWarningLimit: 1500,
  },
});
