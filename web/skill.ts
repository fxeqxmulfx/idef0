/**
 * The Skill dialog: a short guide to writing IDEF0 models in this language. The guide is
 * skill/SKILL.md, which is also an Agent Skill, so the dialog offers it for copying and saving.
 * This module is loaded the first time the dialog opens.
 */
import { marked } from 'marked';
import skill from '../skill/SKILL.md?raw';
import { downloadFile } from './files.ts';

/** The YAML block at the top of a skill file, which tells an AI assistant when to use it. */
const FRONT_MATTER = /^---\n[\s\S]*?\n---\n/;

let ready = false;

/** Opens the dialog, filling it in the first time. */
export function showSkill(dialog: HTMLDialogElement): void {
  if (!ready) {
    setUp(dialog);
    ready = true;
  }
  dialog.showModal();
}

function setUp(dialog: HTMLDialogElement): void {
  const body = dialog.querySelector<HTMLElement>('.skill-body');
  if (!body) throw new Error('missing .skill-body');
  // SKILL.md is part of this site, so its HTML can be used as it is. It goes after the note.
  body.insertAdjacentHTML('beforeend', marked.parse(skill.replace(FRONT_MATTER, ''), { async: false }));

  for (const button of dialog.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
    const action = button.dataset.action;
    if (action === 'copy') button.addEventListener('click', () => void copy(button));
    if (action === 'download') button.addEventListener('click', () => downloadFile(skill, 'SKILL.md', 'text/markdown'));
    if (action === 'close') button.addEventListener('click', () => dialog.close());
  }

  // A click on the backdrop lands on the dialog itself; its content covers the rest of it.
  // Both ends of the click must be there, so letting go of a text selection outside does not close it.
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === dialog));
  dialog.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === dialog) dialog.close();
  });
}

async function copy(button: HTMLButtonElement): Promise<void> {
  const label = 'Copy';
  try {
    await navigator.clipboard.writeText(skill);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => (button.textContent = label), 1500);
}
