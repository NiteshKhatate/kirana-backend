const http = require('node:http');
const request = http.get(
  {
    hostname: '127.0.0.1',
    port: Number(process.env.PORT ?? 3001),
    path: '/api/v1/health',
    timeout: 3000,
  },
  (response) => {
    response.resume();
    process.exitCode = response.statusCode === 200 ? 0 : 1;
  },
);
request.on('timeout', () => request.destroy());
request.on('error', () => {
  process.exitCode = 1;
});
