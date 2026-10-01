// PM2 process file:  pm2 start deploy/ecosystem.config.cjs
// Single instance on purpose: the settlement / pending / CFD / tournament workers run in-process.
module.exports = {
  apps: [
    {
      name: 'y2markets-api',
      cwd: __dirname + '/..',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '1G',
      kill_timeout: 10000,
      time: true,
    },
  ],
};
