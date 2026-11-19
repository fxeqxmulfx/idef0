/**
 * Opening and saving files. Chrome and Edge have the File System Access API, so a model that
 * was opened is saved back to the same file. Other browsers get a file input and a download.
 */

interface FilePickerOptions {
  id?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
  suggestedName?: string;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: FilePickerOptions) => Promise<FileSystemFileHandle>;
  }
}

const PICKER: FilePickerOptions = {
  id: 'idef0',
  types: [{ description: 'IDEF0 models', accept: { 'text/plain': ['.idef0'] } }],
};

/** A model file: its name and, where the browser allows, a handle to write it again. */
export interface ModelFile {
  name: string;
  handle?: FileSystemFileHandle;
}

/** Asks for a model file and reads it. Resolves to undefined if the person cancels. */
export async function openFile(): Promise<(ModelFile & { text: string }) | undefined> {
  if (window.showOpenFilePicker) {
    const handle = (await cancellable(window.showOpenFilePicker(PICKER)))?.[0];
    if (!handle) return undefined;
    const file = await handle.getFile();
    return { name: file.name, handle, text: await file.text() };
  }
  const file = await pickWithInput('.idef0,text/plain');
  return file && { name: file.name, text: await file.text() };
}

/**
 * Writes `text` to the file `to.handle`. Without one it asks where to save, or, where the
 * browser cannot ask, downloads the text as `to.name`. Resolves to the file written, or to
 * undefined if the person cancels.
 */
export async function saveFile(text: string, to: ModelFile): Promise<ModelFile | undefined> {
  let handle = to.handle;
  if (!handle && window.showSaveFilePicker) {
    handle = await cancellable(window.showSaveFilePicker({ ...PICKER, suggestedName: to.name }));
    if (!handle) return undefined;
  }
  if (!handle) {
    // A text type can make the browser add ".txt" to the name.
    downloadFile(text, to.name, 'application/octet-stream');
    return { name: to.name };
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return { name: handle.name, handle };
}

/** Hands `data` to the browser as a download named `name`. */
export function downloadFile(data: BlobPart, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The picker's result, or undefined if the person closed it. */
async function cancellable<T>(picker: Promise<T>): Promise<T | undefined> {
  try {
    return await picker;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return undefined;
    throw e;
  }
}

function pickWithInput(accept: string): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    const done = (file: File | undefined) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0]));
    input.addEventListener('cancel', () => done(undefined));
    document.body.append(input);
    input.click();
  });
}
