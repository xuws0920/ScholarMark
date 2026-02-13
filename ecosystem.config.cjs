module.exports = {
  apps: [
    {
      name: "pdf-reader",
      cwd: "D:/pdf-reader",
      script: "./node_modules/vite/bin/vite.js",
      interpreter: "node",
      args: "--host localhost --port 5173 --strictPort",
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: "development"
      }
    }
  ]
};
