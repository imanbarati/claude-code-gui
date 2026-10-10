// One-click starter prompts shown above the composer.
// Each template is a function so it can adapt to the selected text / workdir.

export interface PromptTemplate {
  id: string
  label: string
  icon: string
  build: (ctx: { selection?: string; workdir: string }) => string
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'explain',
    label: 'Explain code',
    icon: '🔍',
    build: ({ selection, workdir }) =>
      selection
        ? `Explain what this code does, step by step:\n\n\`\`\`\n${selection}\n\`\`\``
        : `Explore the project at ${workdir || 'the working directory'} and explain its overall structure and how the main pieces fit together.`
  },
  {
    id: 'tests',
    label: 'Write tests',
    icon: '🧪',
    build: ({ selection, workdir }) =>
      selection
        ? `Write thorough unit tests for this code, covering edge cases:\n\n\`\`\`\n${selection}\n\`\`\``
        : `Find the main modules in ${workdir || 'the project'} and add unit tests for their core behavior.`
  },
  {
    id: 'review',
    label: 'Review & fix',
    icon: '🐞',
    build: ({ workdir }) =>
      `Review the recent changes in ${workdir || 'the project'} for bugs, security issues, and style problems, then fix the most important ones.`
  },
  {
    id: 'refactor',
    label: 'Refactor',
    icon: '♻️',
    build: ({ selection }) =>
      selection
        ? `Refactor this code to be cleaner and more maintainable without changing its behavior:\n\n\`\`\`\n${selection}\n\`\`\``
        : `Identify one area of the codebase that would benefit most from refactoring and improve it, keeping behavior identical.`
  },
  {
    id: 'docs',
    label: 'Add docs',
    icon: '📚',
    build: ({ workdir }) =>
      `Add clear documentation (docstrings/comments and a short README section) for the main entry points in ${workdir || 'the project'}.`
  },
  {
    id: 'scaffold',
    label: 'Scaffold app',
    icon: '🏗️',
    build: ({ workdir }) =>
      `Scaffold a small, runnable starter app in ${workdir || 'the current folder'} with a clear file layout, then run it to confirm it works.`
  }
]

export function buildPrompt(id: string, ctx: { selection?: string; workdir: string }): string {
  const t = PROMPT_TEMPLATES.find((x) => x.id === id)
  if (!t) return ''
  return t.build(ctx)
}
