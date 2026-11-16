const traverse = require("traverse");

/**
 * Optimized implementation of removeUnusedComponents.
 * 
 * Key optimizations:
 * 1. Reachability-first component traversal skips unreachable component bodies
 * 2. Iterative graph analysis avoids recursive removal and repeated equality checks
 * 3. In-place deletion avoids cloning when callers own the document
 * 4. Uses Sets for constant-time reachability lookups
 */
function removeUnusedComponents(oas, { mutate = false } = {}) {
  if (!oas.components) {
    return oas;
  }

  // Step 1: Index component values so reachable references can be followed
  // without first walking every component body.
  const defined = new Map();
  for (const [category, items] of Object.entries(oas.components)) {
    if (items && typeof items === "object") {
      for (const name of Object.keys(items)) {
        defined.set(`components.${category}.${name}`, { category, name, value: items[name] });
      }
    }
  }

  if (defined.size === 0) {
    return oas;
  }

  // Step 2: Find references outside components. These are the roots of the
  // component graph; component bodies are scanned lazily only when reached.
  const referencedFromPaths = new Set();
  const collectRefs = (startNode, refs, skipRootComponents = false) => {
    const stack = [{ node: startNode, root: true }];
    while (stack.length > 0) {
      const { node, root } = stack.pop();
      if (!node || typeof node !== "object") continue;

      if (node["$ref"] && typeof node["$ref"] === "string") {
        const ref = node["$ref"];
        if (ref.startsWith("#/components/")) {
          refs.add(ref.slice(2).replace(/\//g, "."));
        }
      }

      if (node["operationId"] && node["security"]) {
        for (const item of node["security"]) {
          for (const key of Object.keys(item)) refs.add(`components.securitySchemes.${key}`);
        }
      }

      for (const key of Object.keys(node)) {
        if (root && skipRootComponents && key === "components") continue;
        const child = node[key];
        if (child && typeof child === "object") stack.push({ node: child, root: false });
      }
    }
  };

  collectRefs(oas, referencedFromPaths, true);

  // Add global security schemes as roots.
  if (oas.security) {
    for (const item of oas.security) {
      for (const key of Object.keys(item)) referencedFromPaths.add(`components.securitySchemes.${key}`);
    }
  }

  // Step 3: Compute reachability, walking each component body only after it is
  // reached. Large orphaned component trees are never traversed.
  const reachable = new Set();
  const queue = [...referencedFromPaths];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const current = queue[queueIndex];
    if (reachable.has(current)) continue;
    const component = defined.get(current);
    if (!component) continue;
    reachable.add(current);

    const refs = new Set();
    collectRefs(component.value, refs);
    for (const ref of refs) {
      if (!reachable.has(ref)) queue.push(ref);
    }
  }

  // Step 4: Compute unused components
  const unused = new Set();
  for (const comp of defined.keys()) {
    if (!reachable.has(comp)) {
      unused.add(comp);
    }
  }

  if (unused.size === 0) {
    return oas;
  }

  // Step 5: Remove unused components. Callers that own this document can opt
  // into mutation and avoid cloning the entire OAS tree just to delete entries
  // from components. The default remains non-mutating for API compatibility.
  const result = mutate ? oas : traverse(oas).clone();
  
  const unusedByCategory = new Map();
  for (const compPath of unused) {
    const { category, name } = defined.get(compPath);
    if (!unusedByCategory.has(category)) unusedByCategory.set(category, []);
    unusedByCategory.get(category).push(name);
  }
  for (const [category, names] of unusedByCategory) {
    const items = result.components[category];
    if (!items) continue;
    for (const name of names) delete items[name];
    if (Object.keys(items).length === 0) delete result.components[category];
  }

  return result;
}

/**
 * Determine if a path is inside a component definition.
 * Returns the component path (e.g., "components.schemas.Foo") or null.
 */
function getContainingComponent(path) {
  if (path.length < 3) return null;
  if (path[0] !== "components") return null;
  
  // path[0] = "components", path[1] = category, path[2] = name
  return `components.${path[1]}.${path[2]}`;
}

/**
 * Get all components referenced by $ref in a given object.
 * Uses traverse for compatibility with existing API.
 */
function getReferencedComponents(oas) {
  const components = new Set();
  
  traverse(oas).forEach(function () {
    if (this.isLeaf && this.key === "$ref") {
      components.add(this.node.replace("#/", "").replace(/\//g, "."));
    }

    // Per-operation security schemes
    if (this.node && this.node["operationId"] && this.node["security"]) {
      for (const item of this.node["security"]) {
        for (const key of Object.keys(item)) {
          components.add(`components.securitySchemes.${key}`);
        }
      }
    }
  });

  return Array.from(components);
}

/**
 * Get global security schemes from the OAS document.
 */
function getSecuritySchemes(oas) {
  const components = [];
  if (oas.security) {
    for (const item of oas.security) {
      for (const key of Object.keys(item)) {
        components.push(`components.securitySchemes.${key}`);
      }
    }
  }
  return components;
}

/**
 * Remove specified components from the OAS document.
 * Clones the document first to avoid mutation.
 */
function removeSpecifiedComponents(oas, unused) {
  const unusedSet = new Set(unused);
  const result = traverse(oas).clone();
  
  for (const compPath of unusedSet) {
    const parts = compPath.split(".");
    if (parts.length !== 3 || parts[0] !== "components") continue;
    
    const category = parts[1];
    const name = parts[2];
    
    if (result.components && result.components[category] && result.components[category][name]) {
      delete result.components[category][name];
      
      // Remove empty category
      if (Object.keys(result.components[category]).length === 0) {
        delete result.components[category];
      }
    }
  }
  
  return result;
}

/**
 * Get all defined components in the OAS document.
 */
function getDefinedComponents(oas) {
  const defined = [];
  if (!oas.components) return defined;
  
  for (const [category, items] of Object.entries(oas.components)) {
    if (items && typeof items === "object") {
      for (const name of Object.keys(items)) {
        defined.push(`components.${category}.${name}`);
      }
    }
  }
  
  return defined;
}

/**
 * Get unused components (defined but not referenced).
 */
function getUnusedComponents(all, referenced, oas) {
  const referencedSet = new Set(referenced);
  return all.filter(comp => !referencedSet.has(comp));
}

module.exports = {
  getReferencedComponents,
  getDefinedComponents,
  getUnusedComponents,
  removeSpecifiedComponents,
  removeUnusedComponents,
  getSecuritySchemes,
};
