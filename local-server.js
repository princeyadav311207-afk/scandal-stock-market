const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = __dirname;
const port = Number(process.argv[2] || 5173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.resolve(root, urlPath === "/" ? "index.html" : `.${urlPath}`);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`SCANDAL STOCK MARKET running on this device: http://localhost:${port}`);
  Object.values(os.networkInterfaces()).flat().filter(Boolean).forEach((info) => {
    if (info.family === "IPv4" && !info.internal) {
      console.log(`Phone/tablet URL: http://${info.address}:${port}`);
    }
  });
});
