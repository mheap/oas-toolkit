const traverse = require("traverse");

/**
 * Optimized implementation of removeUnusedComponents.
 * 
 * Key optimizations:
 * 1. Single-pass reference collection instead of multiple traverse calls
 * 2. Graph-based reachability analysis instead of recursive removal with isEqual checks
 * 3. In-place deletion instead of clone + traverse + remove
 * 4. Uses Set for O(1) lookups instead of Array.includes
 */
function removeUnusedComponents(oas) {
  if (!oas.components) {
    return oas;
  }

  // Step 1: Collect all defined components (single iteration over components keys)
  const defined = new Set();
  for (const [category, items] of Object.entries(oas.components)) {
    if (items && typeof items === "object") {
      for (const name of Object.keys(items)) {
        defined.add(`components.${category}.${name}`);
      }
    }
  }

  if (defined.size === 0) {
    return oas;
  }

  // Step 2: Build reference graph - single traversal of entire document
  // We need to know: for each component, what other components does it reference?
  // And what components are referenced from paths (the roots)?
  const referencedFromPaths = new Set();
  const componentRefs = new Map(); // Map<componentPath, Set<referencedComponentPaths>>

  // Initialize componentRefs for all defined components
  for (const comp of defined) {
    componentRefs.set(comp, new Set());
  }

  // Single traversal to collect all references
  traverse(oas).forEach(function () {
    if (!this.node || typeof this.node !== "object") return;

    // Collect $ref
    if (this.node["$ref"] && typeof this.node["$ref"] === "string") {
      const refPath = this.node["$ref"].replace("#/", "").replace(/\//g, ".");
      
      // Determine if this ref is inside a component or in paths/elsewhere
      const containingComponent = getContainingComponent(this.path);
      
      if (containingComponent) {
        // This ref is inside a component - add to component's references
        const refs = componentRefs.get(containingComponent);
        if (refs) {
          refs.add(refPath);
        }
      } else {
        // This ref is in paths or elsewhere - it's a root reference
        referencedFromPaths.add(refPath);
      }
    }

    // Collect security scheme references from operations
    if (this.node["operationId"] && this.node["security"]) {
      for (const item of this.node["security"]) {
        for (const key of Object.keys(item)) {
          const secPath = `components.securitySchemes.${key}`;
          const containingComponent = getContainingComponent(this.path);
          if (containingComponent) {
            const refs = componentRefs.get(containingComponent);
            if (refs) refs.add(secPath);
          } else {
            referencedFromPaths.add(secPath);
          }
        }
      }
    }
  });

  // Add global security schemes as roots
  if (oas.security) {
    for (const item of oas.security) {
      for (const key of Object.keys(item)) {
        referencedFromPaths.add(`components.securitySchemes.${key}`);
      }
    }
  }

  // Step 3: Compute reachable components using BFS from roots
  const reachable = new Set();
  const queue = [...referencedFromPaths];
  
  while (queue.length > 0) {
    const current = queue.shift();
    
    if (reachable.has(current)) continue;
    if (!defined.has(current)) continue; // Not a defined component
    
    reachable.add(current);
    
    // Add all components referenced by this component to the queue
    const refs = componentRefs.get(current);
    if (refs) {
      for (const ref of refs) {
        if (!reachable.has(ref)) {
          queue.push(ref);
        }
      }
    }
  }

  // Step 4: Compute unused components
  const unused = new Set();
  for (const comp of defined) {
    if (!reachable.has(comp)) {
      unused.add(comp);
    }
  }

  if (unused.size === 0) {
    return oas;
  }

  // Step 5: Remove unused components in-place
  // Clone first to avoid modifying original (use traverse.clone to preserve object structure)
  const result = traverse(oas).clone();
  
  for (const compPath of unused) {
    const parts = compPath.split(".");
    // parts = ["components", category, name]
    const category = parts[1];
    const name = parts[2];
    
    if (result.components[category] && result.components[category][name]) {
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
