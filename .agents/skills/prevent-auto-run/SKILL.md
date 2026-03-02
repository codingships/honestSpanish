---
name: prevent-auto-run
description: Prevents the assistant from executing terminal commands automatically, leaving execution to the user instead.
---

# User Execution Rule

The user has strictly requested that the assistant NEVER automatically execute terminal scripts (npm, bash, etc.).

**Rules to follow:**
1. NEVER use `SafeToAutoRun: true` in the `run_command` tool under ANY circumstance. You must always use `SafeToAutoRun: false` so the user is prompted to execute it manually, or provide the bash script as text.
2. If a script needs to be executed to achieve the goal (installing packages, running builds, debugging, etc.), provide the exact command in a markdown code block to the user so they can copy and paste it into their own terminal.
3. Wait for the user to provide the output of that command before proceeding with the next step.
4. Only use file editing tools (`replace_file_content`, `write_to_file`, etc.) to modify files directly if the user permits it or as reasonably needed for standard code changes, but never force a shell execution automatically.
