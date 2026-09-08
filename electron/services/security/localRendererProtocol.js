const path = require('path');
const { pathToFileURL } = require('url');

const LOCAL_RENDERER_SCHEME = 'nova-app';
const LOCAL_RENDERER_HOST = 'renderer';
const LOCAL_RENDERER_URL = `${LOCAL_RENDERER_SCHEME}://${LOCAL_RENDERER_HOST}/index.html`;

function registerLocalRendererScheme(protocol) {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false
      }
    }
  ]);
}

function resolveLocalRendererPath(rootDirectory, requestUrl) {
  const root = path.resolve(rootDirectory);
  const parsed = new URL(requestUrl);
  if (
    parsed.protocol !== `${LOCAL_RENDERER_SCHEME}:`
    || parsed.hostname !== LOCAL_RENDERER_HOST
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('Renderer URL is not allowed.');
  }

  const relativePath = decodeURIComponent(parsed.pathname).replace(/^[/\\]+/, '');
  if (!relativePath) {
    throw new Error('Renderer URL must identify a file.');
  }

  const resolvedPath = path.resolve(root, relativePath);
  const relativeResolvedPath = path.relative(root, resolvedPath);
  if (relativeResolvedPath.startsWith('..') || path.isAbsolute(relativeResolvedPath)) {
    throw new Error('Renderer URL escapes the application root.');
  }
  return resolvedPath;
}

function registerLocalRendererProtocol({ protocol, net, rootDirectory }) {
  protocol.handle(LOCAL_RENDERER_SCHEME, (request) => {
    try {
      const filePath = resolveLocalRendererPath(rootDirectory, request.url);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (_error) {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = {
  LOCAL_RENDERER_URL,
  registerLocalRendererProtocol,
  registerLocalRendererScheme,
  resolveLocalRendererPath
};
