import {defineConfig} from 'vite';
import {sites} from '@openai/sites-vite-plugin';
export default defineConfig({plugins:[sites()],publicDir:false,build:{outDir:'dist/server',emptyOutDir:true,lib:{entry:'server/worker.mjs',formats:['es'],fileName:()=> 'index.js'},minify:false}});
