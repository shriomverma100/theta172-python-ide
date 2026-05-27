import Logger from '../core/Logger.js';

/**
 * Service to handle file system operations.
 * Wraps Electron IPC calls to decouple UI from backend APIs.
 */
class FileSystemServiceClass {
  /**
   * Save a file.
   * @param {string} filePath 
   * @param {string} content 
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async saveFile(filePath, content) {
    if (window.electronAPI && window.electronAPI.saveFile) {
      try {
        const result = await window.electronAPI.saveFile(filePath, content);
        Logger.info('FileSystemService', `Saved file: ${filePath}`);
        return result;
      } catch (err) {
        Logger.error('FileSystemService', `Failed to save file: ${err.message}`);
        return { success: false, error: err.message };
      }
    } else {
      Logger.warn('FileSystemService', 'saveFile not available in web mode');
      return { success: false, error: 'Web environment not supported' };
    }
  }

  /**
   * Save a file as...
   * @param {string} content 
   * @param {string} defaultName 
   * @returns {Promise<{success: boolean, filePath?: string, error?: string, canceled?: boolean}>}
   */
  async saveFileAs(content, defaultName) {
    if (window.electronAPI && window.electronAPI.saveFileAs) {
      try {
        const result = await window.electronAPI.saveFileAs(content, defaultName);
        if (result.success && !result.canceled) {
          Logger.info('FileSystemService', `Saved file as: ${result.filePath}`);
        }
        return result;
      } catch (err) {
        Logger.error('FileSystemService', `Failed to save file as: ${err.message}`);
        return { success: false, error: err.message };
      }
    } else {
      // Fallback for web
      try {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultName || 'code.py';
        a.click();
        URL.revokeObjectURL(url);
        Logger.info('FileSystemService', 'Downloaded file via web fallback');
        return { success: true, filePath: a.download };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  }

  /**
   * Open a file dialog and read content.
   * @returns {Promise<{success: boolean, filePath?: string, content?: string, error?: string, canceled?: boolean}>}
   */
  async openFile() {
    if (window.electronAPI && window.electronAPI.openFile) {
      try {
        const result = await window.electronAPI.openFile();
        if (result.success && !result.canceled) {
          Logger.info('FileSystemService', `Opened file: ${result.filePath}`);
        }
        return result;
      } catch (err) {
        Logger.error('FileSystemService', `Failed to open file: ${err.message}`);
        return { success: false, error: err.message };
      }
    } else {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.py,.txt,.js,.json,.md';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) {
            resolve({ success: true, canceled: true });
            return;
          }
          const reader = new FileReader();
          reader.onload = (re) => {
            Logger.info('FileSystemService', `Opened file via web fallback: ${file.name}`);
            resolve({
              success: true,
              filePath: file.name,
              content: re.target.result,
              canceled: false
            });
          };
          reader.onerror = () => {
            resolve({ success: false, error: 'Failed to read file' });
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }
  }
}

export const FileSystemService = new FileSystemServiceClass();
