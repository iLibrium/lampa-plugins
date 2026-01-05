const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/entry.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2018'],
  outfile: 'plugins/plugin.js',
  charset: 'utf8',
  legalComments: 'none',
  banner: {
    js: "'use strict';"
  }
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[build] watching...');
    return;
  }

  await esbuild.build(options);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
