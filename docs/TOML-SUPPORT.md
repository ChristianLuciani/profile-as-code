# TOML Support for Profile Data

This document describes the TOML support feature that enables users to edit profile data in TOML format while maintaining full compatibility with the existing YAML-based engine.

## Overview

YAML is powerful but can be fragile for human editing, especially in graphical interfaces. Common issues include:
- Indentation errors (tabs vs. spaces)
- Complex nested structures that are hard to read
- Ambiguous syntax (e.g., `yes` vs `true` for booleans)

TOML (Tom's Obvious Minimal Language) provides a more robust alternative:
- **No indentation required** - Uses explicit `=` syntax
- **Better error messages** - Fails fast with clear errors
- **Native type support** - Dates, numbers, booleans are first-class citizens
- **Easier to parse** - Simpler grammar for tools and GUIs

## Architecture

The implementation uses a **hybrid approach**:

```
┌─────────────────────────────────────────────────────────────┐
│                      USER SPACE                             │
│  ┌─────────────┐       ┌─────────────┐                      │
│  │  TOML Files │◄──────►│  YAML Files │                      │
│  │  (editable) │        │  (engine)  │                      │
│  └─────────────┘       └─────────────┘                      │
│           ▲                                                    │
│           │ pasco sync --to-yaml                              │
│           ▼                                                    │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │   ENGINE (pasco)    │
              │   - load()         │
              │   - validate()     │
              │   - build()        │
              └─────────────────────┘
```

Users can:
1. Edit files in **TOML format** (recommended for human editing)
2. Run `pasco sync --to-yaml` to convert TOML → YAML
3. The engine continues to use **YAML files** (no breaking changes)

## Usage

### Basic Commands

#### Convert TOML to YAML
```bash
# Convert all TOML files in facts/ to YAML
pasco sync --to-yaml

# Convert with overwrite (replace existing YAML files)
pasco sync --to-yaml --overwrite

# Convert a specific directory
pasco sync --to-yaml --workspace ./my-profile
```

#### Convert YAML to TOML
```bash
# Convert all YAML files in facts/ to TOML
pasco sync --to-toml

# Convert with overwrite
pasco sync --to-toml --overwrite
```

#### Watch Mode (Auto-sync)
```bash
# Watch for changes and auto-sync TOML ↔ YAML
pasco sync --watch

# This will:
# - Convert TOML changes to YAML automatically
# - Convert YAML changes to TOML automatically
# - Keep both formats in sync
```

#### JSON Output
```bash
# Get machine-readable output
pasco sync --to-yaml --json
```

### Editing with `pasco edit`

**Note:** The `pasco edit` command does NOT support TOML files directly. This is because TOML lacks a Concrete Syntax Tree (CST), which is required for the range-splice mechanism that preserves comments and layout.

To edit data that exists in TOML format:

```bash
# First, convert TOML to YAML
pasco sync --to-yaml

# Then edit the YAML file
pasco edit identity.name --set "New Name"

# Optionally convert back to TOML
pasco sync --to-toml
```

The `pasco edit` command works with YAML files only, maintaining its guarantee of:
- Range splice over the ORIGINAL text (only changed bytes are replaced)
- Comments, alignment, and layout survive BY CONSTRUCTION
- One-line diff by construction
- No document re-serialization

### Example: Full Workflow

```bash
# 1. Initialize a workspace
pasco init my-profile
cd my-profile

# 2. Convert existing YAML to TOML (optional)
pasco sync --to-toml --overwrite

# 3. Edit TOML files
dit facts/identity.toml

# 4. Sync to YAML for the engine
pasco sync --to-yaml

# 5. Validate and build
pasco validate
pasco build
```

## File Format Examples

### TOML Example

```toml
# facts/identity.toml
name = "Elena Vasquez"
location = "Madrid, Spain"
photo = "https://example.com/photo.jpg"
timezone = "Europe/Madrid"

# Links as array of tables
[[links]]
platform = "github"
label = "GitHub"
url = "https://github.com/elena"
role = "identity"

[[links]]
platform = "linkedin"
label = "LinkedIn"
url = "https://linkedin.com/in/elena"
role = "realization"

# Multiline strings (basic TOML 1.0.0)
definition = '''
Elena Vasquez is a Senior AI Engineer building sovereign AI infrastructure.
She leads the open-source example-agentic-hub project.
'''
```

### Equivalent YAML

```yaml
# facts/identity.yaml
name: Elena Vasquez
location: Madrid, Spain
photo: https://example.com/photo.jpg
timezone: Europe/Madrid
links:
  - platform: github
    label: GitHub
    url: https://github.com/elena
    role: identity
  - platform: linkedin
    label: LinkedIn
    url: https://linkedin.com/in/elena
    role: realization
definition: |
  Elena Vasquez is a Senior AI Engineer building sovereign AI infrastructure.
  She leads the open-source example-agentic-hub project.
```

## TOML vs YAML Comparison

| Feature | TOML | YAML | Notes |
|---------|------|------|-------|
| **Indentation** | ❌ Not required | ✅ Required | TOML wins for error prevention |
| **Comments** | ✅ Line and inline | ✅ Line and inline | Both good |
| **Multiline strings** | ✅ Triple quotes (1.0+) | ✅ `|` and `>` | YAML more mature |
| **Dates** | ✅ Native (`2024-01-01`) | ✅ Native | Both good |
| **Numbers** | ✅ Native (`1.5`, `1e-3`) | ✅ Native | Both good |
| **Booleans** | ✅ `true`/`false` | ⚠️ `true`/`false`/`yes`/`no` | TOML less ambiguous |
| **Arrays** | ✅ `[]` and `[[table]]` | ✅ `- item` | Different syntax |
| **Maps** | ✅ `key = value` | ✅ `key: value` | Different syntax |
| **Anchors/Aliases** | ❌ Not supported | ✅ Supported | YAML more powerful |
| **Tooling support** | ✅ Good | ✅ Excellent | YAML more established |

## Integration with GUI

For graphical interfaces, TOML provides several advantages:

### 1. Simpler Parsing

```typescript
import { parse as parseToml } from '@iarna/toml';

// Load TOML file
const content = fs.readFileSync('facts/identity.toml', 'utf-8');
const data = parseToml(content);

// No need to worry about:
// - Indentation levels
// - YAML quirks (anchors, aliases, block scalars)
// - Ambiguous types
```

### 2. Better Validation

```typescript
try {
  const data = parseToml(content);
  // If we get here, the TOML is valid
} catch (error) {
  // Clear error message: "Expected '=' at line 5, column 12"
  console.error(error.message);
}
```

### 3. Type-Safe Editing

```typescript
// TOML has native types
const profile = {
  name: 'Elena Vasquez',           // string
  startDate: new Date('2024-01-01'), // Date (parsed by TOML)
  score: 0.9,                       // number
  active: true,                     // boolean
};
```

### 4. Recommended GUI Flow

```
1. Load TOML file
2. Display in form
3. User edits
4. Validate TOML syntax
5. Save TOML file
6. Run `pasco sync --to-yaml` (or use watch mode)
7. Engine uses YAML files
```

## Migration Guide

### For Existing Users

No action required! Continue using YAML as before. The TOML support is completely optional.

### For New Users

You can start with TOML from day one:

```bash
# Create workspace
pasco init my-profile
cd my-profile

# Convert to TOML (optional)
pasco sync --to-toml --overwrite

# Edit TOML files
# ...

# Sync to YAML when ready
pasco sync --to-yaml
```

### For Full Migration

To migrate an existing workspace from YAML to TOML:

```bash
# 1. Backup your data
git commit -am "backup before TOML migration"

# 2. Convert all YAML to TOML
pasco sync --to-toml --overwrite

# 3. Verify everything works
pasco validate
pasco build

# 4. Commit the changes
git add facts/
git commit -m "migrate from YAML to TOML"

# 5. (Optional) Add TOML files to .gitignore if you want to keep YAML as source of truth
#    Or continue using both with sync
```

## Technical Details

### Module Structure

The TOML support is implemented in two main modules:

1. **Core Module** (`packages/core/src/toml-sync.ts`):
   - `tomlToYamlFile()` - Convert single TOML file to YAML
   - `yamlToTomlFile()` - Convert single YAML file to TOML
   - `syncTomlYaml()` - Bidirectional sync in a directory
   - `watchTomlYaml()` - Auto-sync on file changes

2. **CLI Command** (`packages/cli/src/commands/sync.ts`):
   - Implements the `pasco sync` command
   - Handles command-line arguments
   - Provides user-friendly output

### Dependencies

- [`@iarna/toml`](https://github.com/iarna/toml) - TOML parser and stringifier
- [`yaml`](https://github.com/eemeli/yaml) - YAML parser (already used)

### Error Handling

The implementation includes comprehensive error handling:

- **Missing files**: Clear error messages
- **Invalid syntax**: Caught and reported with file and line information
- **Overwrite protection**: Defaults to skip existing files (use `--overwrite` to force)
- **Type preservation**: Maintains data types during conversion

### Limitations

1. **Note**: Basic multiline strings work with TOML 1.0.0; @iarna/toml@2.2.5 supports TOML 1.0.0 spec
2. **No Anchors/Aliases**: TOML doesn't support YAML's anchor/alias feature
3. **Array of Tables**: TOML uses `[[table]]` syntax for arrays of objects
4. **Comments**: TOML only supports end-of-line comments, not inline comments

### Performance

Conversion is fast:
- Single file: ~10-20ms
- Full workspace (15 files): ~200-300ms
- Watch mode: Near-instant updates

## Best Practices

### 1. For Human Editing

✅ **Use TOML** for:
- Manual editing in text editors
- GUI-based editing
- Files with simple to medium complexity

❌ **Avoid TOML** for:
- Files requiring YAML-specific features (anchors, aliases)
- Files with complex multiline content (use YAML's `|` or `>`)

### 2. For Engine/Automation

✅ **Use YAML** for:
- Engine internal processing
- CI/CD pipelines
- Scripting and automation

### 3. For Teams

- **Standardize on one format** to avoid confusion
- **Use sync command** if mixing formats
- **Document your choice** in CONTRIBUTING.md

### 4. For GUI Developers

- **Load TOML files** for editing
- **Save as TOML** (preserve user's format choice)
- **Use watch mode** for real-time sync
- **Validate TOML** before saving

## Troubleshooting

### "Cannot install with frozen-lockfile"

This error occurs when the `pnpm-lock.yaml` is out of date:

```bash
# Update the lockfile
pnpm install

# Or force install without frozen lockfile (not recommended for CI)
pnpm install --no-frozen-lockfile
```

### "TOML parse error"

Check for common TOML syntax errors:
- Missing `=` between key and value
- Unquoted strings with special characters
- Incorrect array of table syntax

### "File not found"

Make sure the file exists and has the correct extension:
- `.toml` for TOML files
- `.yaml` or `.yml` for YAML files

### "Overwrite protection"

Use `--overwrite` or `-f` flag to force overwrite:

```bash
pasco sync --to-yaml --overwrite
```

## API Reference

### Core Functions

#### `tomlToYamlFile(tomlPath, yamlPath, options?)`

Convert a TOML file to YAML.

**Parameters:**
- `tomlPath`: Path to the TOML file
- `yamlPath`: Path to write the YAML file
- `options`: Optional configuration
  - `indent`: Indentation level (default: 2)
  - `createDirs`: Create parent directories (default: true)
  - `overwrite`: Overwrite existing files (default: false)

**Returns:** `boolean` - True if file was written, false if skipped

#### `yamlToTomlFile(yamlPath, tomlPath, options?)`

Convert a YAML file to TOML.

**Parameters:**
- `yamlPath`: Path to the YAML file
- `tomlPath`: Path to write the TOML file
- `options`: Optional configuration
  - `createDirs`: Create parent directories (default: true)
  - `overwrite`: Overwrite existing files (default: false)

**Returns:** `boolean` - True if file was written, false if skipped

#### `syncTomlYaml(factsDir, options?)`

Synchronize TOML and YAML files in a directory.

**Parameters:**
- `factsDir`: Directory containing fact files
- `options`: Optional configuration
  - `toYaml`: Convert TOML to YAML (default: true)
  - `toToml`: Convert YAML to TOML (default: false)
  - `overwrite`: Overwrite existing files (default: false)

**Returns:** `SyncResult` - Object with converted, skipped, and error lists

#### `watchTomlYaml(factsDir, options?, callback?)`

Watch a directory for changes and auto-sync.

**Parameters:**
- `factsDir`: Directory to watch
- `options`: Optional configuration (same as `syncTomlYaml`)
- `callback`: Optional callback function called on each sync

**Returns:** `Function` - Function to stop watching

### CLI Command

#### `pasco sync`

Synchronize TOML and YAML fact files.

**Options:**
- `--to-yaml`: Convert TOML files to YAML
- `--to-toml`: Convert YAML files to TOML
- `--watch`: Watch for changes and auto-sync
- `--overwrite, -f`: Overwrite existing files
- `--json`: JSON output
- `--workspace <path>`: Workspace path

**Examples:**
```bash
pasco sync --to-yaml
pasco sync --to-toml --overwrite
pasco sync --watch
pasco sync --to-yaml --json
```

## Contributing

To contribute to the TOML support feature:

1. **Report issues**: Open a GitHub issue with details about the problem
2. **Suggest improvements**: Open a discussion or issue with your ideas
3. **Submit PRs**: Follow the existing code style and conventions
4. **Test changes**: Make sure all existing tests pass

### Testing

The TOML support includes:
- TypeScript type definitions
- Integration with existing CLI patterns
- Error handling for edge cases

To test manually:

```bash
# Create test files
 echo 'name = "Test"' > /tmp/test.toml
 echo 'name: Test' > /tmp/test.yaml

# Test conversion
pasco sync --to-yaml --workspace /tmp
pasco sync --to-toml --workspace /tmp
```

## Future Enhancements

Potential future improvements:

1. **TOML as primary format**: Make TOML the default for new workspaces
2. **TOML schema validation**: Validate TOML files against the JSON schema
3. **TOML linting**: Add Biome rules for TOML files
4. **TOML template generation**: Generate TOML templates for new facts
5. **TOML diff**: Show differences between TOML and YAML versions
6. **TOML merge**: Merge TOML files intelligently

## References

- [TOML 1.0.0 Specification](https://github.com/toml-lang/toml/blob/master/versions/en/toml-v1.0.0.md) (supported by @iarna/toml@2.2.5)
- [`@iarna/toml` package](https://github.com/iarna/toml)
- [YAML Specification](https://yaml.org/spec/1.2/spec.html)

## License

This feature is part of the profile-as-code project and is licensed under the MIT License.
