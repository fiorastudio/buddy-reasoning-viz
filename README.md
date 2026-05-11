# buddy-reasoning-viz

CLI tool to visualize the reasoning graph from [Buddy](https://github.com/fiorastudio/buddy) — the coding companion for Claude Code.

Reads `~/.buddy/buddy.db` (claims, edges, findings from guard/insight mode) and generates an interactive vis.js network graph in your browser.

## Install

```bash
bun install
bun link
```

This registers `buddy-graph` as a global command.

## Usage

```bash
# Generate and open the full reasoning graph
buddy-graph

# Filter to a specific session
buddy-graph <session_id>
```

## What it shows

- **Nodes** = claims (colored by epistemic basis: research, empirical, deduction, analogy, vibes, etc.)
- **Edges** = relationships (supports, depends_on, contradicts, questions)
- **Borders** = findings (red = caution like load_bearing_vibes; green = kudos like well_sourced_load_bearer)
- **Shape** = speaker (diamond = user, circle = assistant)

Sidebar includes session filter, search, basis isolation, click-to-inspect detail, and stats.

## Requirements

- [Bun](https://bun.sh) runtime
- [Buddy](https://github.com/fiorastudio/buddy) with guard/insight mode enabled (populates `~/.buddy/buddy.db`)
