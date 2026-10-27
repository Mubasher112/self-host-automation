const TYPES = new Set(['manual', 'webhook', 'http', 'map']);
export function validateGraph(graph) {
  const errors = []; const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []; const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  if (!graph?.name?.trim()) errors.push('Workflow name is required.');
  if (nodes.length < 2) errors.push('Add a trigger and at least one action.');
  const ids = new Set(); for (const node of nodes) { if (!node.id || ids.has(node.id)) errors.push('Node IDs must be unique.'); ids.add(node.id); if (!TYPES.has(node.type)) errors.push(`Unsupported node type: ${node.type}`); }
  const triggers = nodes.filter((n) => ['manual','webhook'].includes(n.type)); if (triggers.length !== 1) errors.push('Exactly one manual or webhook trigger is required.');
  const incoming = new Map(nodes.map((n) => [n.id, 0])); const adjacency = new Map(nodes.map((n) => [n.id, []]));
  for (const edge of edges) { if (!ids.has(edge.from) || !ids.has(edge.to)) errors.push('Every connection must reference an existing node.'); else { adjacency.get(edge.from).push(edge.to); incoming.set(edge.to, incoming.get(edge.to) + 1); } }
  if (triggers[0] && incoming.get(triggers[0].id) !== 0) errors.push('The trigger cannot have an incoming connection.');
  for (const n of nodes.filter((x) => !['manual','webhook'].includes(x.type))) if (incoming.get(n.id) === 0) errors.push(`${n.name || n.type} is not connected.`);
  const queue = nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id); let seen = 0; const copy = new Map(incoming);
  while (queue.length) { const current = queue.shift(); seen++; for (const next of adjacency.get(current) || []) { copy.set(next, copy.get(next) - 1); if (copy.get(next) === 0) queue.push(next); } }
  if (seen !== nodes.length) errors.push('Cycles are not supported.');
  for (const node of nodes) { if (node.type === 'http' && !node.config?.url) errors.push(`${node.name || 'HTTP request'} needs a URL.`); if (node.type === 'map' && (!node.config?.mapping || typeof node.config.mapping !== 'object')) errors.push(`${node.name || 'Map data'} needs a JSON mapping.`); }
  return { valid: errors.length === 0, errors };
}
export function template(name = 'Untitled workflow') { return { name, nodes: [{ id:'trigger', type:'manual', name:'Manual trigger', x:80, y:150, config:{} }, { id:'action', type:'http', name:'HTTP request', x:390, y:150, config:{ method:'GET', url:'https://example.com', headers:{}, body:'' } }], edges:[{ id:'edge_1', from:'trigger', to:'action' }] }; }
export function resolveTemplate(value, context) {
  if (Array.isArray(value)) return value.map((v) => resolveTemplate(v, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, resolveTemplate(v, context)]));
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, path) => { const found = path.split('.').reduce((v,k) => v?.[k], context); if (found == null) throw new Error(`Missing value: ${path}`); return typeof found === 'object' ? JSON.stringify(found) : String(found); });
}
