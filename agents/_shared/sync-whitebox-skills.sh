#!/usr/bin/env bash
# Copies the whitebox skills from _shared/whitebox-skills into the three whitebox agents (claudeAgent, claudeAgentB,
# claudeAgentMcp). Each agent loads skills from its own .claude/skills folder, so the copies must stay identical.
# Edit the files in _shared/whitebox-skills only, then run: bash agents/_shared/sync-whitebox-skills.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/whitebox-skills"
for agent in claudeAgent claudeAgentB claudeAgentMcp; do
  for skill in "$src"/*/; do
    name="$(basename "$skill")"
    dest="$here/../$agent/.claude/skills/$name"
    mkdir -p "$dest"
    cp "$skill"SKILL.md "$dest/SKILL.md"
  done
  echo "synced -> $agent"
done
