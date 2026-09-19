// Fail before importing Vite or creating any listener on this embedded board.
if (process.platform !== 'darwin') {
  console.error('離線預算圖工具僅允許在 macOS 執行。請勿在 i.MX93 啟動渲染器。');
  process.exit(1);
}
const { createServer } = await import('vite');
const server = await createServer({
  configFile: false,
  root: new URL('.', import.meta.url).pathname,
  publicDir: new URL('../public', import.meta.url).pathname,
  server: { host: '127.0.0.1', port: 5174, strictPort: true, open: '/export.html' },
});
await server.listen();
server.printUrls();
