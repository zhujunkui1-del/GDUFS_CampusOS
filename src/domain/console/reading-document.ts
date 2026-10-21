export function readingDocument(html: string) {
  const policy =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src https: data:; media-src https:; font-src data:; frame-src 'none'; object-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html{overflow-x:hidden}body{margin:0;padding:0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.8;color:#333;overflow-wrap:break-word}img,video{max-width:100%;height:auto}#campusos-article{display:flow-root;max-width:100%}table{max-width:100%}a{overflow-wrap:anywhere}</style></head><body><div id="campusos-article">${html}</div></body></html>`;
}
