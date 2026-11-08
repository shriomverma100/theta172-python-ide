/**
 * THETA172 — Student-side guards for teacher edits.
 *
 * Messages from the classroom network are untrusted: whoever is acting as
 * "teacher" controls them. The student's app is the only place that can
 * enforce the student's choice, so every edit is checked here before it
 * touches the editor.
 */

/** Max size of a full-file push from the teacher (characters). */
export const MAX_PUSHED_CODE = 500_000;

/** Max size of one incremental insert (characters). */
export const MAX_LIVE_INSERT = 50_000;

/**
 * May a full-code push replace the student's editor content?
 * @param {boolean} permissionGranted student has granted edit access
 * @param {unknown} data message payload ({ code })
 */
export function canApplyPushedCode(permissionGranted, data) {
  if (!permissionGranted) return false;
  if (!data || typeof data.code !== 'string') return false;
  if (data.code.length === 0 || data.code.length > MAX_PUSHED_CODE) return false;
  return true;
}

/**
 * Validate an incremental edit. Returns the change to apply, or null.
 * Offsets must be integers inside the current document, otherwise
 * CodeMirror throws a RangeError and the edit would corrupt the file.
 * @param {boolean} permissionGranted
 * @param {unknown} data message payload ({ from, to, insert })
 * @param {number} docLength current document length
 * @returns {{ from: number, to: number, insert: string } | null}
 */
export function validateLiveEdit(permissionGranted, data, docLength) {
  if (!permissionGranted || !data) return null;
  const { from, to, insert } = data;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (typeof insert !== 'string' || insert.length > MAX_LIVE_INSERT) return null;
  if (from < 0 || to < from || to > docLength) return null;
  return { from, to, insert };
}
