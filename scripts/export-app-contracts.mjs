import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const sources = [
  path.join(repoRoot, "crates", "app-contracts", "src", "lib.rs"),
  path.join(repoRoot, "crates", "app-domain", "src", "dto.rs"),
  path.join(repoRoot, "crates", "app-domain", "src", "types.rs"),
  path.join(repoRoot, "crates", "network-binding", "src", "types.rs"),
];

const outputPath = path.join(
  repoRoot,
  "apps",
  "web",
  "console",
  "src",
  "generated",
  "appTypes.ts",
);
const checkOnly = process.argv.includes("--check");

function toCamelCase(input) {
  return input.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
}

function pascalToSnakeCase(input) {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function renameVariant(name, renameRule) {
  switch (renameRule) {
    case "lowercase":
      return name.toLowerCase();
    case "snake_case":
      return pascalToSnakeCase(name).replace(/^web_socket/, "websocket");
    case "camelCase":
      return toCamelCase(name.charAt(0).toLowerCase() + name.slice(1));
    default:
      return name;
  }
}

function mapRustType(typeName) {
  const trimmed = typeName.trim();

  if (trimmed.startsWith("Option<") && trimmed.endsWith(">")) {
    return `${mapRustType(trimmed.slice("Option<".length, -1))} | null`;
  }

  if (trimmed.startsWith("Vec<") && trimmed.endsWith(">")) {
    return `${mapRustType(trimmed.slice("Vec<".length, -1))}[]`;
  }

  switch (trimmed) {
    case "String":
      return "string";
    case "bool":
      return "boolean";
    case "i8":
    case "i16":
    case "i32":
    case "i64":
    case "isize":
    case "u8":
    case "u16":
    case "u32":
    case "u64":
    case "usize":
    case "f32":
    case "f64":
      return "number";
    case "Value":
      return "Record<string, unknown>";
    default:
      return trimmed;
  }
}

function parseStructs(sourceText, declarations) {
  const structPattern =
    /#\[derive\([^\]]+\)\]\s*#\[serde\(rename_all = "(camelCase|snake_case|lowercase)"\)\]\s*pub struct (\w+)\s*\{([\s\S]*?)\n\}/g;
  const fieldPattern = /^\s*(?:#\[.*\]\s*)*pub\s+(\w+):\s*([^,]+),\s*$/gm;

  let structMatch = structPattern.exec(sourceText);
  while (structMatch) {
    const [, , name, body] = structMatch;
    if (declarations.has(name)) {
      structMatch = structPattern.exec(sourceText);
      continue;
    }

    const fields = [];
    let fieldMatch = fieldPattern.exec(body);
    while (fieldMatch) {
      const [, fieldName, typeName] = fieldMatch;
      fields.push({
        name: toCamelCase(fieldName),
        type: mapRustType(typeName),
      });
      fieldMatch = fieldPattern.exec(body);
    }
    fieldPattern.lastIndex = 0;

    declarations.set(name, {
      kind: "struct",
      name,
      fields,
    });
    structMatch = structPattern.exec(sourceText);
  }
}

function parseEnums(sourceText, declarations) {
  const enumPattern =
    /#\[derive\([^\]]+\)\]\s*#\[serde\(rename_all = "(camelCase|snake_case|lowercase)"\)\]\s*pub enum (\w+)\s*\{([\s\S]*?)\n\}/g;

  let enumMatch = enumPattern.exec(sourceText);
  while (enumMatch) {
    const [, renameRule, name, body] = enumMatch;
    if (declarations.has(name)) {
      enumMatch = enumPattern.exec(sourceText);
      continue;
    }
    if (body.includes("(") || body.includes("{")) {
      enumMatch = enumPattern.exec(sourceText);
      continue;
    }

    const variants = body
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/^#\[.*\]\s*/g, ""))
      .filter(Boolean)
      .map((variant) => renameVariant(variant, renameRule));

    declarations.set(name, {
      kind: "enum",
      name,
      variants,
    });
    enumMatch = enumPattern.exec(sourceText);
  }
}

function parseAliases(sourceText, declarations) {
  const aliasPattern = /^pub type (\w+) = ([^;]+);$/gm;

  let aliasMatch = aliasPattern.exec(sourceText);
  while (aliasMatch) {
    const [, name, target] = aliasMatch;
    if (declarations.has(name)) {
      aliasMatch = aliasPattern.exec(sourceText);
      continue;
    }

    declarations.set(name, {
      kind: "alias",
      name,
      target: mapRustType(target),
    });
    aliasMatch = aliasPattern.exec(sourceText);
  }
}

function renderDeclaration(declaration) {
  if (declaration.kind === "struct") {
    const fields = declaration.fields
      .map((field) => `  ${field.name}: ${field.type};`)
      .join("\n");
    return `export type ${declaration.name} = {\n${fields}\n};`;
  }

  if (declaration.kind === "enum") {
    return `export type ${declaration.name} = ${declaration.variants
      .map((variant) => JSON.stringify(variant))
      .join(" | ")};`;
  }

  return `export type ${declaration.name} = ${declaration.target};`;
}

function main() {
  const declarations = new Map();

  for (const sourcePath of sources) {
    const sourceText = fs.readFileSync(sourcePath, "utf8");
    parseStructs(sourceText, declarations);
    parseEnums(sourceText, declarations);
    parseAliases(sourceText, declarations);
  }

  if (declarations.size === 0) {
    throw new Error("No declarations were parsed from Rust sources");
  }

  const rendered = Array.from(declarations.values())
    .map((declaration) => renderDeclaration(declaration))
    .join("\n\n");

  const outputText = `// Generated from app Rust contracts/domain sources. Do not edit by hand.\n\n${rendered}\n`;
  const currentText = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;

  if (checkOnly) {
    if (currentText !== outputText) {
      console.error(`contracts_out_of_date=${outputPath}`);
      process.exitCode = 1;
      return;
    }
    console.log(`contracts=up_to_date`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, outputText);
  console.log(`exported=${outputPath}`);
}

main();
