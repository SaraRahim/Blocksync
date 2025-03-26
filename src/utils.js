// Utility functions for BlockSync app

/**
 * Format file size in human-readable format
 * @param {number} bytes - File size in bytes
 * @returns {string} - Formatted file size (e.g. "15.2 MB")
 */
export const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    if (!bytes) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  };
  
  /**
   * Format date relative to current time
   * @param {Date} date - The date to format
   * @returns {string} - Relative time (e.g. "2 hours ago")
   */
  export const formatRelativeDate = (date) => {
    if (!date) return '';
    
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    const diffMonth = Math.floor(diffDay / 30);
    const diffYear = Math.floor(diffDay / 365);
    
    if (diffYear > 0) {
      return diffYear === 1 ? '1 year ago' : `${diffYear} years ago`;
    } else if (diffMonth > 0) {
      return diffMonth === 1 ? '1 month ago' : `${diffMonth} months ago`;
    } else if (diffDay > 0) {
      return diffDay === 1 ? 'Yesterday' : `${diffDay} days ago`;
    } else if (diffHour > 0) {
      return diffHour === 1 ? '1 hour ago' : `${diffHour} hours ago`;
    } else if (diffMin > 0) {
      return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`;
    } else {
      return 'Just now';
    }
  };
  
  /**
   * Determine file type from filename
   * @param {string} filename - Name of the file with extension
   * @returns {string} - File type category
   */
  export const getFileTypeFromName = (filename) => {
    if (!filename) return 'other';
    
    const extension = filename.split('.').pop().toLowerCase();
    
    const typeMap = {
      // Documents
      'doc': 'document', 'docx': 'document', 'pdf': 'document', 'txt': 'document', 'rtf': 'document',
      // Spreadsheets
      'xls': 'spreadsheet', 'xlsx': 'spreadsheet', 'csv': 'spreadsheet',
      // Presentations
      'ppt': 'presentation', 'pptx': 'presentation',
      // Images
      'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'gif': 'image', 'svg': 'image', 'webp': 'image',
      // Audio
      'mp3': 'audio', 'wav': 'audio', 'ogg': 'audio',
      // Video
      'mp4': 'video', 'avi': 'video', 'mov': 'video', 'mkv': 'video', 'webm': 'video',
      // Code
      'js': 'code', 'jsx': 'code', 'ts': 'code', 'tsx': 'code', 'html': 'code', 'css': 'code', 
      'py': 'code', 'java': 'code', 'c': 'code', 'cpp': 'code', 'rb': 'code', 'php': 'code',
      // Archives
      'zip': 'archive', 'rar': 'archive', '7z': 'archive', 'tar': 'archive', 'gz': 'archive'
    };
    
    return typeMap[extension] || 'other';
  };
  
  /**
   * Generate a random ID
   * @param {string} prefix - Prefix for the ID
   * @returns {string} - Random ID with prefix
   */
  export const generateId = (prefix = '') => {
    return prefix + Math.random().toString(36).substr(2, 9);
  };
  
  /**
   * Generate a secure random key
   * @param {number} length - Length of the key
   * @returns {string} - Random key
   */
  export const generateSecretKey = (length = 32) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'B'; // Start with B for BlockSync
    
    for (let i = 0; i < length - 1; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  };
  
  /**
   * Generate a folder path from name
   * @param {string} name - Folder name
   * @returns {string} - Folder path
   */
  export const generateFolderPath = (name) => {
    return `/${name.toLowerCase().replace(/\s+/g, '-')}`;
  };
  
  /**
   * Truncate a string with ellipsis
   * @param {string} str - String to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} - Truncated string
   */
  export const truncateString = (str, maxLength = 20) => {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  };
  
  /**
   * Truncate a blockchain hash
   * @param {string} hash - Blockchain hash
   * @returns {string} - Truncated hash
   */
  export const truncateHash = (hash) => {
    if (!hash) return '';
    if (hash.length <= 13) return hash;
    return hash.substring(0, 6) + '...' + hash.substring(hash.length - 4);
  };
  
  /**
   * Copy text to clipboard
   * @param {string} text - Text to copy
   * @returns {Promise<boolean>} - Success status
   */
  export const copyToClipboard = async (text) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        // Fallback method
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        return success;
      }
    } catch (error) {
      console.error("Error copying to clipboard:", error);
      return false;
    }
  };
  
  /**
   * Generate color from string (e.g., for user avatars)
   * @param {string} str - Input string
   * @returns {string} - HEX color
   */
  export const stringToColor = (str) => {
    if (!str) return '#4F46E5'; // Default color
    
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const colors = [
      '#4F46E5', // Blue
      '#10B981', // Green
      '#F59E0B', // Yellow
      '#EF4444', // Red
      '#8B5CF6', // Purple
      '#EC4899'  // Pink
    ];
    
    // Use hash to pick a color
    return colors[Math.abs(hash) % colors.length];
  };
  
  /**
   * Check if a file exists in a folder
   * @param {Array} folderFiles - Array of files in the folder
   * @param {string} fileName - Name of the file to check
   * @returns {boolean} - Whether the file exists
   */
  export const fileExistsInFolder = (folderFiles, fileName) => {
    if (!folderFiles || !fileName) return false;
    return folderFiles.some(file => file.name === fileName);
  };
  
  /**
   * Format date to locale string
   * @param {Date} date - Date to format
   * @returns {string} - Formatted date
   */
  export const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };