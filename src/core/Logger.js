/**
 * Centralized logging service.
 * Supports log levels and automatically disables verbose output in production.
 */
class Logger {
  static LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  };

  // Default level is DEBUG in dev, INFO in production
  static currentLevel = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') 
    ? Logger.LogLevel.INFO 
    : Logger.LogLevel.DEBUG;

  /**
   * Set global log level
   * @param {number} level 
   */
  static setLevel(level) {
    Logger.currentLevel = level;
  }

  static debug(context, ...args) {
    if (Logger.currentLevel <= Logger.LogLevel.DEBUG) {
      console.debug(`[DEBUG] [${context}]`, ...args);
    }
  }

  static info(context, ...args) {
    if (Logger.currentLevel <= Logger.LogLevel.INFO) {
      console.info(`[INFO] [${context}]`, ...args);
    }
  }

  static warn(context, ...args) {
    if (Logger.currentLevel <= Logger.LogLevel.WARN) {
      console.warn(`[WARN] [${context}]`, ...args);
    }
  }

  static error(context, ...args) {
    if (Logger.currentLevel <= Logger.LogLevel.ERROR) {
      console.error(`[ERROR] [${context}]`, ...args);
    }
  }
}

export default Logger;
