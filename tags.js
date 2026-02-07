/**
 * Optimized implementation of removeUnusedTags.
 * 
 * Key optimizations:
 * 1. Direct iteration over paths instead of full document traversal
 * 2. Uses Set for O(1) lookups instead of Array operations
 * 3. In-place filtering instead of clone + filter
 */

function removeUnusedTags(oas) {
  if (!oas.tags || oas.tags.length === 0) {
    return oas;
  }

  const used = getReferencedTags(oas);
  const usedSet = new Set(used);
  
  // Check if all tags are used
  const allUsed = oas.tags.every(t => usedSet.has(t.name));
  if (allUsed) {
    return oas;
  }

  // Clone and filter
  const result = JSON.parse(JSON.stringify(oas));
  result.tags = result.tags.filter(t => usedSet.has(t.name));
  return result;
}

function removeSpecifiedTags(oas, unused) {
  if (!oas.tags || oas.tags.length === 0 || unused.length === 0) {
    return oas;
  }

  const unusedSet = new Set(unused);
  const result = JSON.parse(JSON.stringify(oas));
  result.tags = result.tags.filter(t => !unusedSet.has(t.name));
  return result;
}

/**
 * Get all tags referenced by operations in the OAS document.
 * Optimized to only traverse paths instead of entire document.
 */
function getReferencedTags(oas) {
  const tags = new Set();
  
  if (!oas.paths) return [];
  
  // Iterate directly over paths and methods
  for (const pathObj of Object.values(oas.paths)) {
    if (!pathObj || typeof pathObj !== "object") continue;
    
    for (const [method, operation] of Object.entries(pathObj)) {
      // Skip non-operation keys like parameters, servers, etc.
      if (!operation || typeof operation !== "object") continue;
      if (!operation.operationId) continue;
      
      if (operation.tags && Array.isArray(operation.tags)) {
        for (const tag of operation.tags) {
          tags.add(tag);
        }
      }
    }
  }
  
  return Array.from(tags);
}

function getDefinedTags(oas) {
  return oas.tags ? oas.tags.map(t => t.name) : [];
}

function getUnusedTags(all, referenced) {
  const referencedSet = new Set(referenced);
  return all.filter(tag => !referencedSet.has(tag));
}

module.exports = {
  getReferencedTags,
  getDefinedTags,
  getUnusedTags,
  removeSpecifiedTags,
  removeUnusedTags,
};
