import {mkdir,copyFile,cp} from 'node:fs/promises';
const source=new URL('../node_modules/pdfjs-dist/',import.meta.url);
const target=new URL('../public/auto-mail-preview/',import.meta.url);
await mkdir(target,{recursive:true});
await Promise.all([
 copyFile(new URL('build/pdf.mjs',source),new URL('pdf.mjs',target)),
 copyFile(new URL('build/pdf.worker.mjs',source),new URL('pdf.worker.mjs',target)),
 copyFile(new URL('LICENSE',source),new URL('PDFJS-LICENSE',target)),
 ...['standard_fonts','cmaps','wasm'].map(name=>cp(new URL(name+'/',source),new URL(name+'/',target),{recursive:true})),
]);
