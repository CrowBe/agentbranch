import type { Distractor } from "./triggering-eval.types";

/**
 * The distractor library — competing skills the user's skill is selected
 * against. v1 ships ~10 (grows to ~30) so triggering is tested competitively,
 * not in isolation (ARCHITECTURE §4). Thin seed list for the shell.
 */
export const distractorLibrary: readonly Distractor[] = [
  { name: "calendar-scheduler", description: "Books and reschedules calendar meetings." },
  { name: "expense-logger", description: "Records receipts and categorises expenses." },
  { name: "doc-summariser", description: "Summarises long documents into bullet points." },
  { name: "crm-updater", description: "Updates contact records in the CRM." },
  { name: "tweet-writer", description: "Drafts social posts in the brand voice." },
  { name: "code-reviewer", description: "Reviews pull requests for bugs and style." },
  { name: "invoice-generator", description: "Creates invoices from billable hours." },
  { name: "translation-helper", description: "Translates text between languages." },
  { name: "weather-reporter", description: "Reports the local weather forecast." },
  { name: "meeting-notetaker", description: "Takes structured notes during meetings." },
];
