// pm2 process config for Slipstream.
//   pm2 start ecosystem.config.cjs && pm2 save
// To enable the Claude path: `npm i @anthropic-ai/sdk`, set ANTHROPIC_API_KEY
// in env below, then `pm2 restart slipstream --update-env`.
module.exports = {
  apps: [
    {
      name: 'slipstream',
      script: 'src/server.js',
      cwd: __dirname,
      time: true,
      env: {
        PORT: '3210',
        // ANTHROPIC_API_KEY: 'sk-ant-...',     // optional — enables Claude enrichment
        // SLIPSTREAM_MODEL: 'claude-sonnet-4-6', // optional — claude-haiku-4-5 (cheap) / claude-opus-4-8 (premium)
      },
    },
  ],
};
