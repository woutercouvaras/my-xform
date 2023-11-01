require('dotenv').config()

module.exports = {
  apps: [
    {
      name: 'my xform solo',
      script: './.output/server/index.mjs',
      autorestart: true,
      max_restarts: 50,
      watch: false,
      max_memory_restart: '1G',
      env_production: {
        PORT: process.env.PORT
      }
    }
  ],
  deploy: {
    production: {
      user: process.env.HOST_USER,
      host: ['85.159.213.43'],
      key: process.env.GITHUB_KEY,
      ref: process.env.GITHUB_BRANCH,
      repo: process.env.GITHUB_REPO,
      path: process.env.TARGET_PATH,
      // 'pre-deploy': '/home/ubuntu/inf/deploy/pre-deploy.sh xform-solo',
      'post-deploy':
        'pnpm install && pnpm build && pm2 reload ecosystem.config.js --env production && pm2 save',
      env: {
        ACCESS_KEY_ID: process.env.ACCESS_KEY_ID,
        SECRET_ACCESS_KEY: process.env.SECRET_ACCESS_KEY,
        BUCKET: process.env.BUCKET,
        REGION: process.env.REGION
      }
    }
  }
}
