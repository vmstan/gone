// Module customization hooks that stub `.svg` text imports for Node's test
// runner. Wrangler injects imported text assets at build time, which plain
// `node --test` cannot resolve, so worker-entry tests register this file to
// substitute a minimal SVG without touching the worker's import shape.
export async function resolve(specifier, context, next) {
  if (specifier.endsWith(".svg")) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith(".svg")) {
    return { format: "module", source: "export default '<svg></svg>';", shortCircuit: true };
  }
  return next(url, context);
}
