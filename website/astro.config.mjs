import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://nishanshetty.github.io',
  base: '/focal',
  integrations: [tailwind()],
  output: 'static',
});
