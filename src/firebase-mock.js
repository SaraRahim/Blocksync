// Enhanced mock implementation of Firebase services for development/demonstration

// Mock database
const mockDb = {
    _data: {},
    _refs: {},
    _listeners: {}
  };
  
  // Initialize with demo data
  const initializeDemoData = () => {
    // Create demo folders
    mockDb._data["folders/folder_demo1"] = {
      name: "Documents",
      path: "/documents",
      size: 1024 * 1024 * 15, // 15MB
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      shared: true,
      shareMode: "read-write",
      secretKey: "BDEMO1234567890ABCDEFGHIJKLMN",
      version: 1,
      devices: 2,
      encrypted: true,
      ownerId: "user_demo",
      color: "#4F46E5"
    };
    
    mockDb._data["folders/folder_demo2"] = {
      name: "Photos",
      path: "/photos",
      size: 1024 * 1024 * 45, // 45MB
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      shared: false,
      shareMode: "read-only",
      secretKey: "BDEMO7890ABCDEFGHIJKLMN1234567",
      version: 1,
      devices: 1,
      encrypted: true,
      ownerId: "user_demo",
      color: "#EC4899"
    };
    
    // Link folders to demo user
    mockDb._data["userFolders/user_demo/folder_demo1"] = {
      added: new Date().toISOString(),
      permission: "owner"
    };
    
    mockDb._data["userFolders/user_demo/folder_demo2"] = {
      added: new Date().toISOString(),
      permission: "owner"
    };
    
    // Add demo files
    mockDb._data["files/file_doc1"] = {
      name: "Project Proposal.docx",
      size: 1024 * 512, // 512KB
      type: "document",
      modified: new Date().toISOString(),
      version: 1
    };
    
    mockDb._data["files/file_doc2"] = {
      name: "Budget.xlsx",
      size: 1024 * 256, // 256KB
      type: "spreadsheet",
      modified: new Date().toISOString(),
      version: 2
    };
    
    mockDb._data["files/file_photo1"] = {
      name: "Vacation.jpg",
      size: 1024 * 1024 * 2.5, // 2.5MB
      type: "image",
      modified: new Date().toISOString(),
      version: 1
    };
    
    mockDb._data["files/file_photo2"] = {
      name: "Family.jpg",
      size: 1024 * 1024 * 3.2, // 3.2MB
      type: "image",
      modified: new Date().toISOString(),
      version: 1
    };
    
    // Link files to folders
    mockDb._data["folderFiles/folder_demo1/file_doc1"] = true;
    mockDb._data["folderFiles/folder_demo1/file_doc2"] = true;
    mockDb._data["folderFiles/folder_demo2/file_photo1"] = true;
    mockDb._data["folderFiles/folder_demo2/file_photo2"] = true;
    
    // Add transaction history
    mockDb._data["userTransactions/user_demo"] = {
      tx1: {
        hash: "0x1a2b3c4d5e6f7g8h9i0j",
        timestamp: new Date().toISOString(),
        sender: "user_demo",
        fileInfo: {
          name: "Project Proposal.docx",
          size: 1024 * 512,
          type: "document",
          infoHash: "file_doc1",
          folderId: "folder_demo1"
        }
      },
      tx2: {
        hash: "0x0j9i8h7g6f5e4d3c2b1a",
        timestamp: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        sender: "user_demo",
        fileInfo: {
          name: "Budget.xlsx",
          size: 1024 * 256,
          type: "spreadsheet",
          infoHash: "file_doc2",
          folderId: "folder_demo1"
        }
      },
      tx3: {
        hash: "0xabcdef1234567890ghij",
        timestamp: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
        sender: "user_demo",
        fileInfo: {
          name: "Vacation.jpg",
          size: 1024 * 1024 * 2.5,
          type: "image",
          infoHash: "file_photo1",
          folderId: "folder_demo2"
        }
      }
    };
  };
  
  // Mock ref function
  export const ref = (db, path) => {
    if (!mockDb._refs[path]) {
      mockDb._refs[path] = {
        path,
        listeners: []
      };
    }
    return mockDb._refs[path];
  };
  
  // Mock set function
  export const set = async (reference, data) => {
    const path = reference.path;
    mockDb._data[path] = JSON.parse(JSON.stringify(data)); // Deep copy
    
    // Notify listeners
    reference.listeners?.forEach(listener => {
      listener({
        val: () => mockDb._data[path],
        exists: () => !!mockDb._data[path]
      });
    });
    
    return Promise.resolve();
  };
  
  // Mock get function
  export const get = async (reference) => {
    const path = reference.path;
    return Promise.resolve({
      val: () => mockDb._data[path] ? JSON.parse(JSON.stringify(mockDb._data[path])) : null,
      exists: () => !!mockDb._data[path]
    });
  };
  
  // Mock remove function
  export const remove = async (reference) => {
    const path = reference.path;
    delete mockDb._data[path];
    return Promise.resolve();
  };
  
  // Mock push function
  export const push = (reference) => {
    const id = 'mock_' + Math.random().toString(36).substring(2, 9);
    const childPath = `${reference.path}/${id}`;
    const childRef = ref(mockDb, childPath);
    return {
      ...childRef,
      key: id
    };
  };
  
  // Mock onValue function
  export const onValue = (reference, callback) => {
    if (!reference.listeners) reference.listeners = [];
    reference.listeners.push(callback);
    
    // Immediately call with current value
    callback({
      val: () => mockDb._data[reference.path] ? JSON.parse(JSON.stringify(mockDb._data[reference.path])) : null,
      exists: () => !!mockDb._data[reference.path]
    });
    
    // Return unsubscribe function
    return () => {
      const index = reference.listeners.indexOf(callback);
      if (index > -1) {
        reference.listeners.splice(index, 1);
      }
    };
  };
  
  // ENHANCED MOCK AUTH WITH VISUAL SIGN-IN
  // Mock Auth
  let currentUser = null;
  const authListeners = [];
  
  // Demo user credentials
  const demoUser = {
    uid: 'user_demo',
    displayName: 'Demo User',
    email: 'demo@example.com',
    photoURL: null
  };
  
  export const auth = {
    onAuthStateChanged: (callback) => {
      authListeners.push(callback);
      // Immediately call with current user
      setTimeout(() => callback(currentUser), 0);
      return () => {
        const index = authListeners.indexOf(callback);
        if (index > -1) {
          authListeners.splice(index, 1);
        }
      };
    },
    // Enhanced signInWithPopup with a simulated popup experience
    signInWithPopup: async (auth, provider) => {
      // Create a popup-like experience
      return new Promise((resolve) => {
        // Create visual modal
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.left = '0';
        modal.style.top = '0';
        modal.style.width = '100%';
        modal.style.height = '100%';
        modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.zIndex = '9999';
        modal.style.fontFamily = 'Arial, sans-serif';
        
        // Create auth popup
        const popup = document.createElement('div');
        popup.style.width = '400px';
        popup.style.backgroundColor = 'white';
        popup.style.borderRadius = '8px';
        popup.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
        popup.style.overflow = 'hidden';
        popup.style.transition = 'all 0.3s ease';
        popup.style.opacity = '0';
        popup.style.transform = 'scale(0.9)';
        
        // Header
        const header = document.createElement('div');
        header.style.padding = '20px';
        header.style.borderBottom = '1px solid #eee';
        header.style.textAlign = 'center';
        
        const title = document.createElement('h2');
        title.textContent = 'Sign in with Google';
        title.style.margin = '0';
        title.style.fontSize = '18px';
        title.style.color = '#202124';
        
        header.appendChild(title);
        popup.appendChild(header);
        
        // Content
        const content = document.createElement('div');
        content.style.padding = '30px 20px';
        content.style.textAlign = 'center';
        
        // Google logo
        const logo = document.createElement('div');
        logo.innerHTML = `
          <svg viewBox="0 0 24 24" width="50" height="50" xmlns="http://www.w3.org/2000/svg">
            <g transform="matrix(1, 0, 0, 1, 27.009001, -39.238998)">
              <path fill="#4285F4" d="M -3.264 51.509 C -3.264 50.719 -3.334 49.969 -3.454 49.239 L -14.754 49.239 L -14.754 53.749 L -8.284 53.749 C -8.574 55.229 -9.424 56.479 -10.684 57.329 L -10.684 60.329 L -6.824 60.329 C -4.564 58.239 -3.264 55.159 -3.264 51.509 Z"/>
              <path fill="#34A853" d="M -14.754 63.239 C -11.514 63.239 -8.804 62.159 -6.824 60.329 L -10.684 57.329 C -11.764 58.049 -13.134 58.489 -14.754 58.489 C -17.884 58.489 -20.534 56.379 -21.484 53.529 L -25.464 53.529 L -25.464 56.619 C -23.494 60.539 -19.444 63.239 -14.754 63.239 Z"/>
              <path fill="#FBBC05" d="M -21.484 53.529 C -21.734 52.809 -21.864 52.039 -21.864 51.239 C -21.864 50.439 -21.724 49.669 -21.484 48.949 L -21.484 45.859 L -25.464 45.859 C -26.284 47.479 -26.754 49.299 -26.754 51.239 C -26.754 53.179 -26.284 54.999 -25.464 56.619 L -21.484 53.529 Z"/>
              <path fill="#EA4335" d="M -14.754 43.989 C -12.984 43.989 -11.404 44.599 -10.154 45.789 L -6.734 42.369 C -8.804 40.429 -11.514 39.239 -14.754 39.239 C -19.444 39.239 -23.494 41.939 -25.464 45.859 L -21.484 48.949 C -20.534 46.099 -17.884 43.989 -14.754 43.989 Z"/>
            </g>
          </svg>
        `;
        
        const account = document.createElement('div');
        account.style.margin = '20px 0';
        account.style.padding = '10px';
        account.style.border = '1px solid #dadce0';
        account.style.borderRadius = '4px';
        account.style.cursor = 'pointer';
        account.style.display = 'flex';
        account.style.alignItems = 'center';
        account.style.transition = 'all 0.2s';
        
        // Hover effect
        account.onmouseover = () => {
          account.style.backgroundColor = '#f8f9fa';
        };
        account.onmouseout = () => {
          account.style.backgroundColor = 'white';
        };
        
        // Avatar
        const avatar = document.createElement('div');
        avatar.style.width = '30px';
        avatar.style.height = '30px';
        avatar.style.borderRadius = '50%';
        avatar.style.backgroundColor = '#4F46E5';
        avatar.style.color = 'white';
        avatar.style.display = 'flex';
        avatar.style.justifyContent = 'center';
        avatar.style.alignItems = 'center';
        avatar.style.fontWeight = 'bold';
        avatar.style.marginRight = '10px';
        avatar.textContent = 'D';
        
        // User info
        const userInfo = document.createElement('div');
        userInfo.style.textAlign = 'left';
        
        const userName = document.createElement('div');
        userName.textContent = 'Demo User';
        userName.style.fontWeight = 'bold';
        
        const userEmail = document.createElement('div');
        userEmail.textContent = 'demo@example.com';
        userEmail.style.fontSize = '14px';
        userEmail.style.color = '#5f6368';
        
        userInfo.appendChild(userName);
        userInfo.appendChild(userEmail);
        
        account.appendChild(avatar);
        account.appendChild(userInfo);
        
        const message = document.createElement('p');
        message.textContent = "This is a demo account. In a real app, you would select your Google account.";
        message.style.fontSize = '14px';
        message.style.color = '#5f6368';
        message.style.margin = '20px 0 0 0';
        
        content.appendChild(logo);
        content.appendChild(account);
        content.appendChild(message);
        popup.appendChild(content);
        
        // Footer
        const footer = document.createElement('div');
        footer.style.padding = '10px 20px 20px';
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.padding = '8px 16px';
        cancelBtn.style.border = '1px solid #dadce0';
        cancelBtn.style.borderRadius = '4px';
        cancelBtn.style.backgroundColor = 'white';
        cancelBtn.style.color = '#3c4043';
        cancelBtn.style.fontWeight = 'bold';
        cancelBtn.style.marginRight = '10px';
        cancelBtn.style.cursor = 'pointer';
        
        const nextBtn = document.createElement('button');
        nextBtn.textContent = 'Sign In';
        nextBtn.style.padding = '8px 16px';
        nextBtn.style.border = 'none';
        nextBtn.style.borderRadius = '4px';
        nextBtn.style.backgroundColor = '#4F46E5';
        nextBtn.style.color = 'white';
        nextBtn.style.fontWeight = 'bold';
        nextBtn.style.cursor = 'pointer';
        
        footer.appendChild(cancelBtn);
        footer.appendChild(nextBtn);
        popup.appendChild(footer);
        
        modal.appendChild(popup);
        document.body.appendChild(modal);
        
        // Animation
        setTimeout(() => {
          popup.style.opacity = '1';
          popup.style.transform = 'scale(1)';
        }, 10);
        
        // Event handlers
        const closeModal = () => {
          popup.style.opacity = '0';
          popup.style.transform = 'scale(0.9)';
          setTimeout(() => {
            document.body.removeChild(modal);
          }, 300);
        };
        
        cancelBtn.onclick = () => {
          closeModal();
          resolve({ user: null });
        };
        
        account.onclick = () => {
          account.style.backgroundColor = '#edf2f7';
        };
        
        nextBtn.onclick = () => {
          // Short loading state
          nextBtn.textContent = 'Signing in...';
          nextBtn.disabled = true;
          
          setTimeout(() => {
            closeModal();
            
            // Set user in mock auth state
            currentUser = demoUser;
            
            // Initialize demo data
            initializeDemoData();
            
            // Notify auth state listeners
            authListeners.forEach(listener => listener(currentUser));
            
            // Return result
            resolve({ user: demoUser });
          }, 800);
        };
      });
    },
    signOut: async () => {
      currentUser = null;
      authListeners.forEach(listener => listener(null));
      return Promise.resolve();
    }
  };
  
  // Mock GoogleAuthProvider
  export class GoogleAuthProvider {
    constructor() {
      this.scopes = [];
    }
    addScope(scope) {
      this.scopes.push(scope);
      return this;
    }
  }
  
  // Mock Storage
  const mockStorage = {
    _files: {}
  };
  
  // Helper to create blob URLs for demo content
  const createDemoFileBlob = (fileType, fileName) => {
    let content = '';
    let type = '';
    
    // Generate content based on file type
    switch (fileType) {
      case 'document':
        content = 'This is a demo document content for ' + fileName;
        type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        break;
      case 'spreadsheet':
        content = 'This is a demo spreadsheet content for ' + fileName;
        type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        break;
      case 'image':
        // Create SVG placeholder for image
        content = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
          <rect width="300" height="200" fill="#f0f0f0"/>
          <text x="50%" y="50%" font-family="Arial" font-size="16" text-anchor="middle">${fileName}</text>
        </svg>`;
        type = 'image/svg+xml';
        break;
      default:
        content = 'Demo content for ' + fileName;
        type = 'text/plain';
    }
    
    const blob = new Blob([content], { type });
    return URL.createObjectURL(blob);
  };
  
  // Initialize demo files in storage
  const initializeDemoStorage = () => {
    // Documents folder files
    mockStorage._files['files/file_doc1'] = createDemoFileBlob('document', 'Project Proposal.docx');
    mockStorage._files['files/file_doc2'] = createDemoFileBlob('spreadsheet', 'Budget.xlsx');
    
    // Photos folder files
    mockStorage._files['files/file_photo1'] = createDemoFileBlob('image', 'Vacation.jpg');
    mockStorage._files['files/file_photo2'] = createDemoFileBlob('image', 'Family.jpg');
    
    // Also add to shared files
    mockStorage._files['sharedFiles/file_doc1'] = mockStorage._files['files/file_doc1'];
    mockStorage._files['sharedFiles/file_doc2'] = mockStorage._files['files/file_doc2'];
    mockStorage._files['sharedFiles/file_photo1'] = mockStorage._files['files/file_photo1'];
    mockStorage._files['sharedFiles/file_photo2'] = mockStorage._files['files/file_photo2'];
  };
  
  // Initialize demo storage
  initializeDemoStorage();
  
  // Mock storageRef
  export const storageRef = (storage, path) => {
    return { fullPath: path };
  };
  
  // Mock uploadBytes
  export const uploadBytes = async (reference, file) => {
    const fileUrl = URL.createObjectURL(file);
    mockStorage._files[reference.fullPath] = fileUrl;
    
    return {
      ref: reference,
      metadata: { name: reference.fullPath.split('/').pop() }
    };
  };
  
  // Mock getDownloadURL
  export const getDownloadURL = async (reference) => {
    if (mockStorage._files[reference.fullPath]) {
      return mockStorage._files[reference.fullPath];
    }
    
    // Create a new blob for this file if it doesn't exist
    const fileName = reference.fullPath.split('/').pop();
    const fileType = fileName.endsWith('.jpg') || fileName.endsWith('.png') ? 'image' : 
                    fileName.endsWith('.docx') ? 'document' :
                    fileName.endsWith('.xlsx') ? 'spreadsheet' : 'other';
    
    const fileUrl = createDemoFileBlob(fileType, fileName);
    mockStorage._files[reference.fullPath] = fileUrl;
    
    return fileUrl;
  };
  
  // Export the mock objects
  export const db = mockDb;
  export const storage = mockStorage;