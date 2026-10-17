const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

async function main() {
  const extension = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: true,
    logLevel: 'info',
  });

  if (watch) {
    await extension.watch();
    return;
  }

  await extension.rebuild();
  await extension.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
