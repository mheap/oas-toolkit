const traverse = require("traverse");
const { default: $RefParser } = require("@apidevtools/json-schema-ref-parser");

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "patch", "options", "head", "trace"]);

async function buildOneOfExplorerModel(oas) {
  const dereferenced = await $RefParser.dereference(traverse(oas).clone(), {
    dereference: {
      circular: "ignore",
    },
  });

  const usages = [];

  traverse(oas).forEach(function () {
    if (!this.node || typeof this.node !== "object" || !Array.isArray(this.node.oneOf)) {
      return;
    }

    usages.push(analyzeOneOfUsage(oas, dereferenced, this.path));
  });

  usages.sort((left, right) => left.path.localeCompare(right.path));

  return {
    specTitle: oas.info && oas.info.title ? oas.info.title : "OpenAPI Spec",
    totalOneOfCount: usages.length,
    oneOfUsages: usages,
  };
}

function analyzeOneOfUsage(rawSpec, dereferencedSpec, path) {
  const rawNode = getAtPath(rawSpec, path) || {};
  const dereferencedNode = getAtPath(dereferencedSpec, path) || rawNode;
  const rawBranches = Array.isArray(rawNode.oneOf) ? rawNode.oneOf : [];
  const dereferencedBranches = Array.isArray(dereferencedNode.oneOf)
    ? dereferencedNode.oneOf
    : rawBranches;

  const internalBranches = ensureUniqueBranchLabels(rawBranches.map((rawBranch, index) => {
    const resolvedBranch = dereferencedBranches[index] || rawBranch;
    const label = getBranchLabel(
      rawBranch,
      resolvedBranch,
      index,
      rawNode.discriminator || dereferencedNode.discriminator
    );

    return {
      index,
      label,
      ref: rawBranch && rawBranch.$ref ? rawBranch.$ref : null,
      summary: summarizeSchema(resolvedBranch),
      isObjectLike: isObjectLikeSchema(resolvedBranch),
      propertyCount: Object.keys((resolvedBranch && resolvedBranch.properties) || {}).length,
      requiredCount: Array.isArray(resolvedBranch && resolvedBranch.required)
        ? resolvedBranch.required.length
        : 0,
      schema: resolvedBranch,
      requiredSet: new Set(Array.isArray(resolvedBranch && resolvedBranch.required) ? resolvedBranch.required : []),
      displaySchema: sanitizeForJson(resolvedBranch),
      rawDisplaySchema: sanitizeForJson(rawBranch),
    };
  }));

  return {
    id: pathToPointer(path),
    pointer: pathToPointer(path),
    path: formatPath(path),
    context: buildUsageContext(path),
    branchCount: internalBranches.length,
    discriminator: summarizeDiscriminator(rawNode.discriminator || dereferencedNode.discriminator),
    branches: internalBranches.map(({ schema, requiredSet, ...branch }) => branch),
    fieldComparison: buildFieldComparison(
      internalBranches,
      rawNode.discriminator || dereferencedNode.discriminator
    ),
    rawOneOf: sanitizeForJson(rawBranches),
  };
}

function ensureUniqueBranchLabels(branches) {
  const seen = new Map();

  return branches.map((branch) => {
    const count = seen.get(branch.label) || 0;
    seen.set(branch.label, count + 1);

    if (count === 0) {
      return branch;
    }

    return {
      ...branch,
      label: `${branch.label} (${count + 1})`,
    };
  });
}

function buildFieldComparison(branches, discriminator) {
  const objectBranches = branches.filter((branch) => branch.isObjectLike);
  const skippedBranchLabels = branches
    .filter((branch) => !branch.isObjectLike)
    .map((branch) => branch.label);

  if (objectBranches.length === 0) {
    return {
      scope: {
        totalBranches: branches.length,
        objectBranchCount: 0,
        skippedBranchLabels,
      },
      commonFields: [],
      differingFields: [],
    };
  }

  const comparison = compareObjectBranches(objectBranches, discriminator);

  return {
    scope: {
      totalBranches: branches.length,
      objectBranchCount: objectBranches.length,
      skippedBranchLabels,
    },
    sharedPaths: comparison.sharedPaths,
    branchViews: comparison.branchViews,
    nonSharedPathCount: comparison.nonSharedPathCount,
  };
}

function compareObjectBranches(branches, discriminator) {
  const flattenedBranches = branches.map((branch) => ({
    label: branch.label,
    paths: flattenSchemaPaths(branch.schema),
  }));
  const allPaths = new Set();

  for (const branch of flattenedBranches) {
    for (const path of Object.keys(branch.paths)) {
      allPaths.add(path);
    }
  }

  const sharedPaths = [];
  const branchViews = branches.map((branch) => ({
    label: branch.label,
    onlyHere: [],
    uniqueSchema: [],
    sharedWithSubset: [],
  }));
  const branchViewMap = new Map(branchViews.map((branchView) => [branchView.label, branchView]));

  for (const path of Array.from(allPaths).sort()) {
    const branchSchemas = flattenedBranches.map((branch) => {
      const entry = branch.paths[path];

      return {
        label: branch.label,
        present: Boolean(entry),
        required: entry ? entry.required : false,
        schemaSummary: entry ? entry.summary : null,
        schema: entry ? entry.schema : null,
      };
    });

    const presentSchemas = branchSchemas.filter((entry) => entry.present);
    if (presentSchemas.length === 0) {
      continue;
    }

    const schemaFingerprints = presentSchemas.map((entry) => JSON.stringify(normalizeSchemaForComparison(
      path,
      entry.schema,
      discriminator
    )));
    const schemaMatchesWherePresent = schemaFingerprints.length <= 1
      || schemaFingerprints.every((fingerprint) => fingerprint === schemaFingerprints[0]);
    const schemaVariants = buildSchemaVariants(presentSchemas);
    const presentIn = presentSchemas.map((entry) => entry.label);
    const missingIn = branchSchemas.filter((entry) => !entry.present).map((entry) => entry.label);
    const requiredIn = branchSchemas.filter((entry) => entry.required).map((entry) => entry.label);
    const optionalIn = branchSchemas.filter((entry) => entry.present && !entry.required).map((entry) => entry.label);

    if (presentSchemas.length === branches.length && schemaMatchesWherePresent) {
      sharedPaths.push({
        path,
        summary: presentSchemas[0].schemaSummary,
        requiredIn,
        optionalIn,
        branchSchemas,
      });
      continue;
    }

    for (const entry of presentSchemas) {
      const variant = schemaVariants.find((candidate) => candidate.members.includes(entry.label));
      const category = presentSchemas.length === 1
        ? "onlyHere"
        : variant && variant.memberCount === 1
          ? "uniqueSchema"
          : "sharedWithSubset";

      branchViewMap.get(entry.label)[category].push({
        path,
        summary: entry.schemaSummary,
        required: entry.required,
        presentIn,
        missingIn,
        peers: variant ? variant.members.filter((member) => member !== entry.label) : [],
        schemaVariantCount: schemaVariants.length,
        schema: entry.schema,
      });
    }
  }

  for (const branchView of branchViews) {
    branchView.onlyHere.sort(sortPathEntries);
    branchView.uniqueSchema.sort(sortPathEntries);
    branchView.sharedWithSubset = compactSharedEntries(
      branchView.sharedWithSubset.sort(sortPathEntries),
      (entry) => entry.presentIn.slice().sort().join("|")
    );
    branchView.totalPathCount = branchView.onlyHere.length + branchView.uniqueSchema.length + branchView.sharedWithSubset.length;
  }

  return {
    sharedPaths: compactSharedEntries(sharedPaths.sort(sortPathEntries), () => "all"),
    branchViews,
    nonSharedPathCount: Array.from(branchViews).reduce((total, branchView) => total + branchView.totalPathCount, 0),
  };
}

function flattenSchemaPaths(schema) {
  const entries = {};

  visitSchemaPaths(schema, "", false, [], entries);

  return entries;
}

function visitSchemaPaths(schema, path, required, ancestors, entries) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return;
  }

  if (path && !schema.items) {
    entries[path] = {
      required,
      summary: summarizeSchema(schema),
      schema: sanitizeForJson(schema),
    };
  }

  if (ancestors.includes(schema)) {
    return;
  }

  const nextAncestors = ancestors.concat(schema);

  if (schema.properties) {
    const requiredSet = new Set(Array.isArray(schema.required) ? schema.required : []);
    for (const [propertyName, propertySchema] of Object.entries(schema.properties)) {
      const propertyPath = path ? `${path}.${propertyName}` : propertyName;
      visitSchemaPaths(propertySchema, propertyPath, requiredSet.has(propertyName), nextAncestors, entries);
    }
  }

  if (schema.items) {
    const itemsPath = path ? `${path}[]` : "[]";
    visitSchemaPaths(schema.items, itemsPath, false, nextAncestors, entries);
  }
}

function sortPathEntries(left, right) {
  return left.path.localeCompare(right.path);
}

function compactSharedEntries(entries, getGroupKey) {
  const kept = [];

  for (const entry of entries) {
    const groupKey = getGroupKey(entry);
    const hasAncestor = kept.some((candidate) => (
      getGroupKey(candidate) === groupKey
      && isDescendantPath(entry.path, candidate.path)
    ));

    if (!hasAncestor) {
      kept.push(entry);
    }
  }

  return kept;
}

function isDescendantPath(path, ancestorPath) {
  return path.startsWith(`${ancestorPath}.`) || path.startsWith(`${ancestorPath}[`);
}

function normalizeSchemaForComparison(path, schema, discriminator) {
  if (!discriminator || !discriminator.propertyName || !schema || typeof schema !== "object") {
    return schema;
  }

  if (path !== discriminator.propertyName) {
    return schema;
  }

  const normalized = { ...schema };

  if (Object.prototype.hasOwnProperty.call(normalized, "const")) {
    normalized.const = "__discriminator__";
  }

  if (Array.isArray(normalized.enum)) {
    normalized.enum = ["__discriminator__"];
  }

  return normalized;
}

function buildSchemaVariants(presentSchemas) {
  const variants = new Map();

  for (const entry of presentSchemas) {
    const fingerprint = JSON.stringify(entry.schema);
    if (!variants.has(fingerprint)) {
      variants.set(fingerprint, {
        fingerprint,
        summary: entry.schemaSummary,
        schema: entry.schema,
        members: [],
        requiredIn: [],
        optionalIn: [],
      });
    }

    const variant = variants.get(fingerprint);
    variant.members.push(entry.label);
    if (entry.required) {
      variant.requiredIn.push(entry.label);
    } else {
      variant.optionalIn.push(entry.label);
    }
  }

  return Array.from(variants.values())
    .map((variant) => ({
      fingerprint: variant.fingerprint,
      summary: variant.summary,
      schema: variant.schema,
      members: variant.members,
      memberCount: variant.members.length,
      requiredIn: variant.requiredIn,
      optionalIn: variant.optionalIn,
    }))
    .sort((left, right) => {
      if (right.memberCount !== left.memberCount) {
        return right.memberCount - left.memberCount;
      }

      return left.members.join(", ").localeCompare(right.members.join(", "));
    });
}

function summarizeSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return {
      type: typeof schema,
      title: null,
      format: null,
      nullable: false,
      enumValues: null,
      constValue: null,
      propertyCount: 0,
      oneOfCount: 0,
      allOfCount: 0,
      anyOfCount: 0,
    };
  }

  return {
    type: inferSchemaType(schema),
    title: schema.title || null,
    format: schema.format || null,
    nullable: Boolean(schema.nullable),
    enumValues: Array.isArray(schema.enum) ? schema.enum.slice(0, 5) : null,
    constValue: Object.prototype.hasOwnProperty.call(schema, "const") ? schema.const : null,
    propertyCount: Object.keys(schema.properties || {}).length,
    oneOfCount: Array.isArray(schema.oneOf) ? schema.oneOf.length : 0,
    allOfCount: Array.isArray(schema.allOf) ? schema.allOf.length : 0,
    anyOfCount: Array.isArray(schema.anyOf) ? schema.anyOf.length : 0,
  };
}

function summarizeDiscriminator(discriminator) {
  if (!discriminator) {
    return null;
  }

  const mappingKeys = discriminator.mapping ? Object.keys(discriminator.mapping).sort() : [];

  return {
    propertyName: discriminator.propertyName || null,
    mappingCount: mappingKeys.length,
    mappingKeys,
  };
}

function getBranchLabel(rawBranch, resolvedBranch, index, discriminator) {
  const refLabel = rawBranch && rawBranch.$ref ? rawBranch.$ref.split("/").pop() : null;
  const titleLabel = resolvedBranch && resolvedBranch.title ? resolvedBranch.title : null;
  const discriminatorLabel = getDiscriminatorLabel(resolvedBranch, discriminator);
  const heuristicLabel = getHeuristicBranchLabel(resolvedBranch);

  if (refLabel && discriminatorLabel && normalizeLabel(refLabel) !== normalizeLabel(discriminatorLabel)) {
    return `${refLabel} (${discriminatorLabel})`;
  }

  if (refLabel) {
    return refLabel;
  }

  if (titleLabel && discriminatorLabel && normalizeLabel(titleLabel) !== normalizeLabel(discriminatorLabel)) {
    return `${titleLabel} (${discriminatorLabel})`;
  }

  if (titleLabel) {
    return titleLabel;
  }

  if (discriminatorLabel) {
    return discriminatorLabel;
  }

  if (heuristicLabel) {
    return heuristicLabel;
  }

  return `Option ${index + 1}`;
}

function getDiscriminatorLabel(schema, discriminator) {
  if (!schema || !discriminator || !discriminator.propertyName) {
    return null;
  }

  return getPropertyValueLabel(schema, discriminator.propertyName);
}

function getHeuristicBranchLabel(schema) {
  if (!schema || typeof schema !== "object") {
    return null;
  }

  if (schema.const !== undefined) {
    return String(schema.const);
  }

  if (Array.isArray(schema.enum) && schema.enum.length === 1) {
    return String(schema.enum[0]);
  }

  const preferredPropertyKeys = [
    "kind",
    "type",
    "eventType",
    "resourceType",
    "objectType",
    "action",
    "status",
    "name",
  ];

  for (const key of preferredPropertyKeys) {
    const label = getPropertyValueLabel(schema, key);
    if (label) {
      return label;
    }
  }

  if (schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const label = getPropertyValueLabel(schema, key);
      if (label) {
        return `${key}=${label}`;
      }
    }
  }

  return null;
}

function getPropertyValueLabel(schema, propertyName) {
  if (!schema || !schema.properties || !schema.properties[propertyName]) {
    return null;
  }

  const propertySchema = schema.properties[propertyName];

  if (propertySchema.const !== undefined) {
    return String(propertySchema.const);
  }

  if (Array.isArray(propertySchema.enum) && propertySchema.enum.length === 1) {
    return String(propertySchema.enum[0]);
  }

  return null;
}

function normalizeLabel(value) {
  return String(value).trim().toLowerCase();
}

function buildUsageContext(path) {
  if (!path.length) {
    return {
      kind: "root",
      primaryLabel: "Document root",
      secondaryLabel: null,
      chips: [],
    };
  }

  if (path[0] === "components" && path.length >= 3) {
    return {
      kind: "component",
      primaryLabel: String(path[2]),
      secondaryLabel: `components.${path[1]}`,
      chips: [humanizeSegment(path[1])],
    };
  }

  if (path[0] === "paths" && path.length >= 2) {
    const route = String(path[1]);
    const methodIndex = path.findIndex((segment, index) => index > 1 && HTTP_METHODS.has(segment));
    const method = methodIndex === -1 ? null : String(path[methodIndex]).toUpperCase();
    const contentIndex = path.indexOf("content");
    const mediaType = contentIndex !== -1 ? String(path[contentIndex + 1]) : null;
    const responsesIndex = path.indexOf("responses");
    const statusCode = responsesIndex !== -1 ? String(path[responsesIndex + 1]) : null;
    const chips = [];

    if (mediaType) {
      chips.push(mediaType);
    }
    if (statusCode) {
      chips.push(`HTTP ${statusCode}`);
    }

    if (path.includes("requestBody")) {
      return {
        kind: "requestBody",
        primaryLabel: method ? `${method} ${route}` : route,
        secondaryLabel: "request body",
        chips,
      };
    }

    if (responsesIndex !== -1) {
      return {
        kind: "response",
        primaryLabel: method ? `${method} ${route}` : route,
        secondaryLabel: statusCode ? `response ${statusCode}` : "response",
        chips,
      };
    }

    if (path.includes("parameters")) {
      return {
        kind: "parameter",
        primaryLabel: method ? `${method} ${route}` : route,
        secondaryLabel: "parameter schema",
        chips,
      };
    }

    return {
      kind: method ? "operation" : "path",
      primaryLabel: method ? `${method} ${route}` : route,
      secondaryLabel: method ? "operation schema" : "path schema",
      chips,
    };
  }

  return {
    kind: "generic",
    primaryLabel: formatPath(path),
    secondaryLabel: null,
    chips: [],
  };
}

function humanizeSegment(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function inferSchemaType(schema) {
  if (!schema || typeof schema !== "object") {
    return typeof schema;
  }

  if (schema.type) {
    return Array.isArray(schema.type) ? schema.type.join(" | ") : schema.type;
  }

  if (schema.properties) {
    return "object";
  }

  if (schema.items) {
    return "array";
  }

  if (schema.enum) {
    return "enum";
  }

  if (schema.oneOf) {
    return "oneOf";
  }

  if (schema.allOf) {
    return "allOf";
  }

  if (schema.anyOf) {
    return "anyOf";
  }

  return "unknown";
}

function isObjectLikeSchema(schema) {
  return Boolean(
    schema
    && typeof schema === "object"
    && !Array.isArray(schema)
    && (schema.type === "object" || schema.properties)
  );
}

function sanitizeForJson(value, seen, currentPath) {
  const localSeen = seen || new WeakMap();
  const path = currentPath || "#";

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (localSeen.has(value)) {
    return {
      $circularRef: localSeen.get(value),
    };
  }

  localSeen.set(value, path);

  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeForJson(item, localSeen, `${path}/${index}`));
  }

  const result = {};

  for (const key of Object.keys(value).sort()) {
    const sanitized = sanitizeForJson(value[key], localSeen, `${path}/${escapePointerSegment(key)}`);

    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }

  return result;
}

function getAtPath(value, path) {
  return path.reduce((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    return current[segment];
  }, value);
}

function pathToPointer(path) {
  if (!path.length) {
    return "#";
  }

  return "#/" + path.map(escapePointerSegment).join("/");
}

function formatPath(path) {
  if (!path.length) {
    return "(root)";
  }

  let output = "";

  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];

    if (typeof segment === "number") {
      output += `[${segment}]`;
      continue;
    }

    const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(segment);
    if (!output) {
      output = isIdentifier ? segment : `[${JSON.stringify(segment)}]`;
      continue;
    }

    output += isIdentifier ? `.${segment}` : `[${JSON.stringify(segment)}]`;
  }

  return output;
}

function escapePointerSegment(segment) {
  return String(segment).replace(/~/g, "~0").replace(/\//g, "~1");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function generateOneOfExplorerHtml(model) {
  const title = `${model.specTitle} oneOf Explorer`;
  const payload = serializeForScript(model);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-100 text-slate-900 antialiased">
  <div id="app"></div>
  <script>
    window.__ONEOF_EXPLORER_DATA__ = ${payload};

    (function () {
      var data = window.__ONEOF_EXPLORER_DATA__;
      var app = document.getElementById("app");
      var state = {
        query: "",
        selectedPointer: null,
        layout: "side-by-side",
        compact: null,
        uniqueVariantsOnly: false,
        selectedPath: null,
        selectedBranchLabel: null
      };

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      function formatJson(value) {
        return escapeHtml(JSON.stringify(value, null, 2));
      }

      function summaryText(summary) {
        if (!summary) {
          return "Unavailable";
        }

        var parts = [];
        if (summary.type) parts.push(summary.type);
        if (summary.format) parts.push(summary.format);
        if (summary.propertyCount) parts.push(String(summary.propertyCount) + " props");
        if (summary.enumValues) parts.push("enum:" + summary.enumValues.join(", "));
        if (summary.constValue !== null) parts.push("const:" + summary.constValue);
        if (summary.oneOfCount) parts.push("oneOf:" + summary.oneOfCount);
        if (summary.allOfCount) parts.push("allOf:" + summary.allOfCount);
        if (summary.anyOfCount) parts.push("anyOf:" + summary.anyOfCount);
        return parts.join(" • ") || "schema";
      }

      function branchMatchesQuery(usage, query) {
        if (!query) {
          return true;
        }

        var searchable = [
          usage.path,
          usage.pointer,
          usage.context && usage.context.primaryLabel ? usage.context.primaryLabel : "",
          usage.context && usage.context.secondaryLabel ? usage.context.secondaryLabel : "",
          usage.context && usage.context.chips ? usage.context.chips.join(" ") : "",
          usage.discriminator && usage.discriminator.propertyName ? usage.discriminator.propertyName : "",
          usage.branches.map(function (branch) { return branch.label; }).join(" ")
        ].join(" ").toLowerCase();

        return searchable.indexOf(query.toLowerCase()) !== -1;
      }

      function chip(text, tone) {
        var styles = {
          neutral: "bg-slate-100 text-slate-600",
          success: "bg-emerald-50 text-emerald-700",
          danger: "bg-rose-50 text-rose-700",
          accent: "bg-indigo-50 text-indigo-700"
        };
        return '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ' + (styles[tone || "neutral"] || styles.neutral) + '">' + escapeHtml(text) + '</span>';
      }

      function outlineButton(label, active, attrs) {
        return '<button ' + attrs + ' class="rounded-full border px-2.5 py-1 text-[11px] font-medium ' + (active ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50') + '">' + escapeHtml(label) + '</button>';
      }

      function linkButton(label, attrs, extraClasses) {
        return '<button ' + attrs + ' class="cursor-pointer text-left text-indigo-700 underline underline-offset-2 hover:text-indigo-600 ' + (extraClasses || '') + '">' + escapeHtml(label) + '</button>';
      }

      function getFilteredUsages() {
        return data.oneOfUsages.filter(function (usage) {
          return branchMatchesQuery(usage, state.query);
        });
      }

      function getSelectedUsage(filteredUsages) {
        if (!filteredUsages.length) {
          return null;
        }

        for (var index = 0; index < filteredUsages.length; index += 1) {
          if (filteredUsages[index].pointer === state.selectedPointer) {
            return filteredUsages[index];
          }
        }

        return filteredUsages[0];
      }

      function readHashState() {
        var hash = window.location.hash.slice(1);
        var params = new URLSearchParams(hash);
        var pointer = params.get("pointer");
        var layout = params.get("layout");
        var compact = params.get("compact");
        var variants = params.get("variants");
        var selectedPath = params.get("path");
        var selectedBranchLabel = params.get("branch");
        if (pointer) state.selectedPointer = pointer;
        if (layout === "accordion" || layout === "side-by-side") state.layout = layout;
        if (compact === "1") state.compact = true;
        if (compact === "0") state.compact = false;
        state.uniqueVariantsOnly = variants === "unique";
        state.selectedPath = selectedPath;
        state.selectedBranchLabel = selectedBranchLabel;
      }

      function writeHashState() {
        var params = new URLSearchParams();
        if (state.selectedPointer) params.set("pointer", state.selectedPointer);
        if (state.layout) params.set("layout", state.layout);
        if (state.compact !== null) params.set("compact", state.compact ? "1" : "0");
        if (state.uniqueVariantsOnly) params.set("variants", "unique");
        if (state.selectedPath) params.set("path", state.selectedPath);
        if (state.selectedBranchLabel) params.set("branch", state.selectedBranchLabel);
        var nextHash = params.toString();
        if (window.location.hash.slice(1) !== nextHash) {
          window.location.hash = nextHash;
        }
      }

      function isCompactMode(selectedUsage) {
        if (state.compact !== null) {
          return state.compact;
        }

        return Boolean(selectedUsage && selectedUsage.branchCount >= 6);
      }

      function renderUsageList(filteredUsages, selectedUsage) {
        if (!filteredUsages.length) {
          return '<div class="rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-center text-sm text-slate-500">No oneOf usages match this search.</div>';
        }

        return filteredUsages.map(function (usage) {
          var active = selectedUsage && usage.pointer === selectedUsage.pointer;
          var context = usage.context || {};
          var chips = [chip(usage.branchCount + ' branches', 'success')];

          (context.chips || []).forEach(function (item) {
            chips.push(chip(item, 'neutral'));
          });

          if (usage.discriminator && usage.discriminator.propertyName) {
            chips.push(chip('discriminator: ' + usage.discriminator.propertyName, 'accent'));
          }

          return ''
            + '<button class="w-full rounded-xl border px-3 py-3 text-left transition ' + (active ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50') + '" data-pointer="' + escapeHtml(usage.pointer) + '">'
            + '  <div class="text-sm font-semibold leading-5 text-slate-900">' + escapeHtml(context.primaryLabel || usage.path) + '</div>'
            +      (context.secondaryLabel ? '<div class="usage-context mt-1 text-xs text-slate-500">' + escapeHtml(context.secondaryLabel) + '</div>' : '')
            + '  <div class="mt-2 break-words font-mono text-[11px] leading-4 text-slate-500">' + escapeHtml(usage.path) + '</div>'
            + '  <div class="mt-2 flex flex-wrap gap-1.5">' + chips.join('') + '</div>'
            + '</button>';
        }).join('');
      }

      function renderPathEntry(pathEntry, mode) {
        var badges = [];
        if (pathEntry.required) {
          badges.push(chip('Required', 'accent'));
        } else if (pathEntry.required === false) {
          badges.push(chip('Optional', 'neutral'));
        }
        if (pathEntry.peers && pathEntry.peers.length) {
          badges.push(chip('Shared with ' + pathEntry.peers.join(', '), 'success'));
        }
        if (pathEntry.missingIn && pathEntry.missingIn.length) {
          badges.push(chip('Missing in ' + pathEntry.missingIn.join(', '), 'danger'));
        }

        var isSelected = state.selectedPath === pathEntry.path;

        return ''
          + '<div class="rounded-lg border px-3 py-2 ' + (isSelected ? 'border-indigo-500 bg-indigo-50/60 shadow-sm' : 'border-slate-200 bg-slate-50') + '">'
          + '  <div class="font-mono text-[12px] font-semibold leading-5 text-slate-800">' + linkButton(pathEntry.path, 'data-path="' + escapeHtml(pathEntry.path) + '"', 'w-full') + '</div>'
          + '  <div class="mt-1.5 flex flex-wrap gap-1.5">' + badges.join('') + '</div>'
          + '  <div class="mt-1.5 text-[12px] leading-5 text-slate-500">' + escapeHtml(summaryText(pathEntry.summary)) + '</div>'
          + '  <details class="mt-2 border-t border-slate-200 pt-2">'
          + '    <summary class="cursor-pointer text-[12px] font-medium text-slate-500">' + escapeHtml(mode === 'shared' ? 'Shared path schema' : 'Path schema') + '</summary>'
          + '    <pre class="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">' + formatJson(pathEntry.schema || { summary: pathEntry.summary }) + '</pre>'
          + '  </details>'
          + '</div>';
      }

      function renderPathList(entries, mode, emptyText) {
        if (!entries.length) {
          return '<div class="empty-inline rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm text-slate-500">' + escapeHtml(emptyText) + '</div>';
        }

        return '<div class="grid gap-2">' + entries.map(function (entry) {
          return renderPathEntry(entry, mode);
        }).join('') + '</div>';
      }

      function getDisplayedEntries(entries) {
        if (!state.uniqueVariantsOnly) {
          return entries;
        }

        var seen = new Set();
        return entries.filter(function (entry) {
          var key = entry.path + '|' + JSON.stringify(entry.schema || entry.summary || null);
          if (seen.has(key)) {
            return false;
          }
          seen.add(key);
          return true;
        });
      }

      function renderBranchBucket(title, entries, emptyText) {
        if (!entries.length) {
          return '<div class="empty-inline rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"><strong>' + escapeHtml(title) + ':</strong> ' + escapeHtml(emptyText) + '</div>';
        }

        return ''
          + '<div class="rounded-xl border border-slate-200 bg-slate-50">'
          + '  <div class="px-3 py-3 text-sm font-semibold text-slate-900">' + escapeHtml(title) + '</div>'
          + '  <div class="grid gap-3 px-3 pb-3">' + renderPathList(entries, 'branch', emptyText) + '</div>'
          + '</div>';
      }

      function renderBranchSpecificSections(branchViews) {
        return branchViews.map(function (branchView) {
          var onlyHere = getDisplayedEntries(branchView.onlyHere);
          var uniqueSchema = getDisplayedEntries(branchView.uniqueSchema);
          var sharedWithSubset = getDisplayedEntries(branchView.sharedWithSubset);

          return ''
            + '<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">'
            + '  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">'
            + '    <div class="text-base font-semibold text-slate-900">' + escapeHtml(branchView.label) + '</div>'
            + '    <div class="flex flex-wrap gap-1.5">' + chip(branchView.totalPathCount + ' paths', 'danger') + '</div>'
            + '  </div>'
            + '  <div class="mb-3 text-sm leading-5 text-slate-500">Flattened branch-specific paths using dot notation and [] for arrays.</div>'
            +      renderBranchBucket('Only in ' + branchView.label, onlyHere, 'No paths exist only in this branch.')
            +      renderBranchBucket('Different schema only in ' + branchView.label, uniqueSchema, 'No uniquely-shaped paths in this branch.')
            +      renderBranchBucket('Shared with subset', sharedWithSubset, 'No subset-shared paths for this branch.')
            + '</div>';
        }).join('');
      }

      function findPathImplementations(selectedUsage, path) {
        var implementations = [];

        selectedUsage.branches.forEach(function (branch) {
          var branchView = selectedUsage.fieldComparison.branchViews.find(function (view) {
            return view.label === branch.label;
          });
          var bucketEntries = [];

          if (branchView) {
            bucketEntries = bucketEntries
              .concat(branchView.onlyHere || [])
              .concat(branchView.uniqueSchema || [])
              .concat(branchView.sharedWithSubset || []);
          }

          var sharedEntry = (selectedUsage.fieldComparison.sharedPaths || []).find(function (entry) {
            return entry.path === path;
          });
          var branchEntry = bucketEntries.find(function (entry) {
            return entry.path === path;
          });
          var implementation = branchEntry || sharedEntry || null;

          implementations.push({
            label: branch.label,
            ref: branch.ref,
            summary: implementation ? implementation.summary : null,
            schema: implementation ? implementation.schema : null,
            present: Boolean(implementation),
            required: implementation ? implementation.required : false,
          });
        });

        return implementations;
      }

      function getSelectedPath(selectedUsage) {
        if (!selectedUsage || !state.selectedPath) {
          return null;
        }

        var allEntries = (selectedUsage.fieldComparison.sharedPaths || []).slice();
        (selectedUsage.fieldComparison.branchViews || []).forEach(function (branchView) {
          allEntries = allEntries
            .concat(branchView.onlyHere || [])
            .concat(branchView.uniqueSchema || [])
            .concat(branchView.sharedWithSubset || []);
        });

        return allEntries.find(function (entry) {
          return entry.path === state.selectedPath;
        }) || null;
      }

      function renderSelectedPath(selectedUsage) {
        var selectedPathEntry = getSelectedPath(selectedUsage);
        if (!selectedUsage || !selectedPathEntry) {
          return '';
        }

        var implementations = findPathImplementations(selectedUsage, selectedPathEntry.path);

        return ''
          + '<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">'
          + '  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">'
          + '    <div class="text-base font-semibold text-slate-900">Path comparison: ' + escapeHtml(selectedPathEntry.path) + '</div>'
          + '  </div>'
          + '  <div class="mb-3 text-sm leading-5 text-slate-500">Compare this path side by side across the oneOf branches.</div>'
          + '  <div class="grid gap-3 overflow-x-auto" style="grid-template-columns: repeat(' + implementations.length + ', minmax(240px, 1fr));">'
          +      implementations.map(function (implementation) {
                   var schemaButton = implementation.ref
                     ? linkButton(implementation.label, 'data-branch-link="' + escapeHtml(implementation.label) + '"')
                     : escapeHtml(implementation.label);
                   return ''
                     + '<div class="rounded-xl border border-slate-200 bg-slate-50 p-3">'
                     + '  <div class="text-sm font-semibold text-slate-900">' + schemaButton + '</div>'
                     + '  <div class="mt-2 flex flex-wrap gap-1.5">'
                     +      (implementation.present ? chip(summaryText(implementation.summary), 'success') : chip('Missing', 'danger'))
                     +      (implementation.required ? chip('Required', 'accent') : '')
                     + '  </div>'
                     +  (implementation.ref ? '<div class="mt-2 text-[12px] leading-5 text-slate-500">Schema: ' + linkButton(implementation.ref, 'data-branch-link="' + escapeHtml(implementation.label) + '"') + '</div>' : '')
                     + '  <details class="mt-2 border-t border-slate-200 pt-2" open>'
                     + '    <summary class="cursor-pointer text-[12px] font-medium text-slate-500">Path schema</summary>'
                     + '    <pre class="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">' + formatJson(implementation.schema || { missing: true }) + '</pre>'
                     + '  </details>'
                     + '</div>';
                 }).join('')
          + '  </div>'
          + '</div>';
      }

      function renderBranches(selectedUsage, compactMode) {
        var branchCards = selectedUsage.branches.map(function (branch) {
          var isSelectedBranch = state.selectedBranchLabel === branch.label;
          var title = branch.ref ? linkButton(branch.label, 'data-branch-link="' + escapeHtml(branch.label) + '"') : escapeHtml(branch.label);

          return ''
            + '<div class="rounded-xl border p-3 ' + (isSelectedBranch ? 'border-indigo-500 bg-indigo-50 shadow-sm' : 'border-slate-200 bg-slate-50') + '">'
            + '  <div class="text-sm font-semibold text-slate-900">' + title + '</div>'
            + '  <div class="mt-2 flex flex-wrap gap-1.5">'
            + '    ' + chip(summaryText(branch.summary), 'accent')
            +      (branch.ref ? '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">' + linkButton(branch.ref, 'data-branch-link="' + escapeHtml(branch.label) + '"') + '</span>' : '')
            +      (branch.isObjectLike ? chip(branch.propertyCount + ' properties', 'success') : chip('raw schema summary', 'danger'))
            + '  </div>'
            + '  <details class="mt-2 border-t border-slate-200 pt-2"' + (compactMode ? '' : ' open') + '>'
            + '    <summary class="cursor-pointer text-[12px] font-medium text-slate-500">Resolved schema</summary>'
            + '    <pre class="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">' + formatJson(branch.displaySchema) + '</pre>'
            + '  </details>'
            + '  <details class="mt-2 border-t border-slate-200 pt-2">'
            + '    <summary class="cursor-pointer text-[12px] font-medium text-slate-500">Original branch</summary>'
            + '    <pre class="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">' + formatJson(branch.rawDisplaySchema) + '</pre>'
            + '  </details>'
            + '</div>';
        }).join('');

        if (state.layout === 'accordion') {
          return selectedUsage.branches.map(function (branch) {
            var isSelectedBranch = state.selectedBranchLabel === branch.label;
            var title = branch.ref ? linkButton(branch.label, 'data-branch-link="' + escapeHtml(branch.label) + '"') : escapeHtml(branch.label);

            return ''
              + '<details class="rounded-xl border border-slate-200 bg-slate-50"' + (isSelectedBranch ? ' open' : '') + '>'
              + '  <summary class="px-3 py-3">'
              + '    <div class="text-sm font-semibold text-slate-900">' + title + '</div>'
              + '    <div class="mt-1 text-[12px] leading-5 text-slate-500">' + escapeHtml(summaryText(branch.summary)) + '</div>'
              + '  </summary>'
              + '  <div class="grid gap-3 px-3 pb-3">'
              + '    <div class="rounded-lg border border-slate-200 bg-white p-3">'
              + '      <div class="flex flex-wrap gap-1.5">'
              +          (branch.ref ? '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">' + linkButton(branch.ref, 'data-branch-link="' + escapeHtml(branch.label) + '"') + '</span>' : '')
              +          (branch.isObjectLike ? chip(branch.propertyCount + ' properties', 'success') : chip('raw schema summary', 'danger'))
              + '      </div>'
              + '      <details class="mt-2 border-t border-slate-200 pt-2"' + (compactMode ? '' : ' open') + '>'
              + '        <summary class="cursor-pointer text-[12px] font-medium text-slate-500">Resolved schema</summary>'
              + '        <pre class="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">' + formatJson(branch.displaySchema) + '</pre>'
              + '      </details>'
              + '      <details class="mt-2 border-t border-slate-200 pt-2">'
              + '        <summary class="cursor-pointer text-[12px] font-medium text-slate-500">Original branch</summary>'
              + '        <pre class="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">' + formatJson(branch.rawDisplaySchema) + '</pre>'
              + '      </details>'
              + '    </div>'
              + '  </div>'
              + '</details>';
          }).join('');
        }

        return '<div class="grid gap-3 overflow-x-auto" style="grid-template-columns: repeat(' + selectedUsage.branches.length + ', minmax(240px, 1fr));">' + branchCards + '</div>';
      }

      function renderDetail(selectedUsage) {
        if (!selectedUsage) {
          return ''
            + '<div class="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">'
            + '  <div class="border-b border-slate-200 px-4 py-4"><h2 class="text-lg font-semibold text-slate-900">No oneOf usage found</h2></div>'
            + '  <div class="grid gap-3 p-4"><div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">This specification does not contain any oneOf nodes.</div></div>'
            + '</div>';
        }

        var context = selectedUsage.context || {};
        var compactMode = isCompactMode(selectedUsage);
        var comparisonTitle = selectedUsage.fieldComparison.scope.skippedBranchLabels.length
          ? 'Flattened path comparison covers ' + selectedUsage.fieldComparison.scope.objectBranchCount + ' object-like branches. '
              + selectedUsage.fieldComparison.scope.skippedBranchLabels.length + ' branch' + (selectedUsage.fieldComparison.scope.skippedBranchLabels.length === 1 ? ' is' : 'es are') + ' shown as raw schema summaries.'
          : 'Flattened path comparison covers every branch in this oneOf.';

        var chips = [chip(selectedUsage.branchCount + ' branches', 'success')];
        if (compactMode) chips.push(chip('compact mode', 'neutral'));
        (context.chips || []).forEach(function (item) { chips.push(chip(item, 'neutral')); });
        if (selectedUsage.discriminator && selectedUsage.discriminator.propertyName) {
          chips.push(chip('discriminator: ' + selectedUsage.discriminator.propertyName, 'accent'));
        }

        return ''
          + '<div class="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">'
          + '  <div class="sticky top-3 z-10 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur">'
          + '    <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">oneOf usage</div>'
          + '    <h1 class="mt-2 text-2xl font-semibold tracking-tight text-slate-900">' + escapeHtml(context.primaryLabel || selectedUsage.path) + '</h1>'
          +      (context.secondaryLabel ? '<div class="mt-1 text-sm text-slate-500">' + escapeHtml(context.secondaryLabel) + '</div>' : '')
          + '    <div class="mt-2 text-sm leading-5 text-slate-500">Inspect shared fields, branch-specific fields, and the raw schemas behind this oneOf.</div>'
          + '    <div class="mt-3 flex flex-wrap gap-1.5">' + chips.join('') + outlineButton('Copy pointer', false, 'data-copy-pointer="' + escapeHtml(selectedUsage.pointer) + '"') + '</div>'
          + '    <div class="mt-2 break-all font-mono text-[11px] leading-5 text-slate-500">' + escapeHtml(selectedUsage.pointer) + '</div>'
          + '  </div>'
          + '  <div class="grid gap-3 p-4">'
          + '    <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">'
          + '      <div class="text-base font-semibold text-slate-900">Comparison scope</div>'
          + '      <p class="mt-2 text-sm leading-5 text-slate-500">' + escapeHtml(comparisonTitle) + '</p>'
          + '      <div class="mt-3 flex flex-wrap gap-1.5">'
          + '        ' + chip(selectedUsage.fieldComparison.sharedPaths.length + ' shared paths', 'success')
          + '        ' + chip(selectedUsage.fieldComparison.nonSharedPathCount + ' branch-specific paths', 'danger')
          + '        ' + chip(state.uniqueVariantsOnly ? 'unique variants only' : 'all branches', 'neutral')
          + '      </div>'
          + '    </div>'
          + '    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">'
          + '      <div class="mb-3 text-base font-semibold text-slate-900">Shared across all branches</div>'
          +        renderPathList(selectedUsage.fieldComparison.sharedPaths, 'shared', 'No shared flattened paths across every branch.')
          + '    </div>'
          +      renderBranchSpecificSections(selectedUsage.fieldComparison.branchViews)
          +      renderSelectedPath(selectedUsage)
          + '    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">'
          + '      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">'
          + '        <div class="text-base font-semibold text-slate-900">Branches</div>'
          + '        <div class="flex flex-wrap gap-2">'
          +           outlineButton('Side by side', state.layout === 'side-by-side', 'data-layout="side-by-side"')
          +           outlineButton('Accordion', state.layout === 'accordion', 'data-layout="accordion"')
          +           outlineButton('Compact', compactMode, 'data-compact="toggle"')
          +           outlineButton('Show only unique variants', state.uniqueVariantsOnly, 'data-variants="toggle"')
          + '        </div>'
          + '      </div>'
          +        renderBranches(selectedUsage, compactMode)
          + '    </div>'
          + '    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">'
          + '      <div class="mb-3 text-base font-semibold text-slate-900">Raw oneOf definition</div>'
          + '      <pre class="overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">' + formatJson(selectedUsage.rawOneOf) + '</pre>'
          + '    </div>'
          + '  </div>'
          + '</div>';
      }

      function render() {
        var filteredUsages = getFilteredUsages();
        var selectedUsage = getSelectedUsage(filteredUsages);

        if (selectedUsage && state.selectedPointer !== selectedUsage.pointer) {
          state.selectedPointer = selectedUsage.pointer;
          writeHashState();
        }

        app.innerHTML = ''
          + '<div class="grid min-h-screen gap-3 p-3 lg:grid-cols-[320px_minmax(0,1fr)]">'
          + '  <aside class="top-3 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:h-[calc(100vh-1.5rem)]">'
          + '    <div class="border-b border-slate-200 px-4 py-4">'
          + '      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">OpenAPI explorer</div>'
          + '      <h2 class="mt-2 text-xl font-semibold tracking-tight text-slate-900">' + escapeHtml(data.specTitle) + '</h2>'
          + '      <div class="mt-1 text-sm leading-5 text-slate-500">Detected ' + data.totalOneOfCount + ' oneOf usage' + (data.totalOneOfCount === 1 ? '' : 's') + ' across the specification.</div>'
          + '      <input class="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:outline-none" type="search" placeholder="Search oneOf usage" value="' + escapeHtml(state.query) + '" data-search-input="true" />'
          + '    </div>'
          + '    <div class="grid gap-2 overflow-auto p-3">' + renderUsageList(filteredUsages, selectedUsage) + '</div>'
          + '  </aside>'
          +      renderDetail(selectedUsage)
          + '</div>';
      }

      app.addEventListener('click', function (event) {
        var usageButton = event.target.closest('[data-pointer]');
        if (usageButton) {
          state.selectedPointer = usageButton.getAttribute('data-pointer');
          writeHashState();
          render();
          return;
        }

        var layoutButton = event.target.closest('[data-layout]');
        if (layoutButton) {
          state.layout = layoutButton.getAttribute('data-layout');
          writeHashState();
          render();
          return;
        }

        var compactButton = event.target.closest('[data-compact]');
        if (compactButton) {
          state.compact = !isCompactMode(getSelectedUsage(getFilteredUsages()));
          writeHashState();
          render();
          return;
        }

        var variantsButton = event.target.closest('[data-variants]');
        if (variantsButton) {
          state.uniqueVariantsOnly = !state.uniqueVariantsOnly;
          writeHashState();
          render();
          return;
        }

        var pathButton = event.target.closest('[data-path]');
        if (pathButton) {
          state.selectedPath = pathButton.getAttribute('data-path');
          writeHashState();
          render();
          return;
        }

        var branchLink = event.target.closest('[data-branch-link]');
        if (branchLink) {
          state.selectedBranchLabel = branchLink.getAttribute('data-branch-link');
          state.layout = 'accordion';
          writeHashState();
          render();
          return;
        }

        var copyButton = event.target.closest('[data-copy-pointer]');
        if (copyButton && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(copyButton.getAttribute('data-copy-pointer'));
        }
      });

      app.addEventListener('input', function (event) {
        if (event.target.matches('[data-search-input]')) {
          state.query = event.target.value;
          render();
        }
      });

      window.addEventListener('hashchange', function () {
        readHashState();
        render();
      });

      readHashState();
      render();
    })();
  </script>
</body>
</html>`;
}

module.exports = {
  buildOneOfExplorerModel,
  generateOneOfExplorerHtml,
};
