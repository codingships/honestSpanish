import { register } from 'node:module';

register(new URL('./astro-env-node-loader.mjs', import.meta.url));
