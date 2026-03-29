import { editFile } from '../tools/edit-file.js';
import { FileOverlay } from '../tools/file-overlay.js';
import { writeNewFile } from '../tools/write-file.js';
import type { FileEdit } from '../graph/state.js';

export async function materializeFileEdits(
  edits: FileEdit[],
): Promise<{ success: true } | { success: false; message: string }> {
  const overlay = new FileOverlay();

  try {
    for (const edit of edits) {
      await overlay.snapshot(edit.file_path);
      const result = edit.old_string.length === 0
        ? await writeNewFile({ file_path: edit.file_path, content: edit.new_string })
        : await editFile({
            file_path: edit.file_path,
            old_string: edit.old_string,
            new_string: edit.new_string,
          });
      if (!result.success) {
        await overlay.rollbackAll();
        return {
          success: false,
          message: result.message ?? `Failed to materialize ${edit.file_path}`,
        };
      }
    }
  } catch (err) {
    await overlay.rollbackAll();
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  overlay.commit();
  return { success: true };
}
